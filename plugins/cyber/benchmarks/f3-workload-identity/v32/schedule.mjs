import { sha256Hex } from '../shared/estate.mjs';
import { resolveIndex } from '../v30/ledger.mjs';

const TYPES = {
  credential: 'credential_ids',
  job: 'job_uids',
  session: 'access_key_refs',
};
const POLICIES = new Set([
  'index',
  'lexicographic',
  'earliest-deadline',
  'earliest-opening',
  'topological',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function scheduleKey(entry) {
  if (
    !record(entry) ||
    !Object.hasOwn(TYPES, entry.entry_type) ||
    typeof entry.entry_id !== 'string' ||
    entry.entry_id.length === 0
  ) {
    throw new Error('v32 schedule entry must have a typed nonempty ID');
  }
  return `${entry.entry_type}:${entry.entry_id}`;
}

function ordered(items, salt, identity = scheduleKey) {
  return [...items].sort((left, right) => {
    const leftKey = identity(left);
    const rightKey = identity(right);
    return (
      sha256Hex(`${salt}|${leftKey}`).localeCompare(sha256Hex(`${salt}|${rightKey}`)) ||
      leftKey.localeCompare(rightKey)
    );
  });
}

function indexMembers(index) {
  if (!record(index?.evidence_index) || !Array.isArray(index.evidence_index.entries)) {
    throw new Error('v32 schedule requires a revisioned evidence index');
  }
  const selected = resolveIndex(index);
  const selectedKeys = new Set();
  for (const [type, collection] of Object.entries(TYPES)) {
    for (const id of selected[collection]) {
      selectedKeys.add(scheduleKey({ entry_type: type, entry_id: id }));
    }
  }
  const all = index.evidence_index.entries.map(({ entry_type, entry_id }) => ({
    entry_type,
    entry_id,
  }));
  const allKeys = new Set(all.map(scheduleKey));
  if (all.length !== 60 || allKeys.size !== 60 || selectedKeys.size !== 30) {
    throw new Error('v32 schedule requires sixty indexed IDs and thirty current IDs');
  }
  return { all, allKeys, selectedKeys };
}

function numericHash(salt) {
  return Number.parseInt(sha256Hex(salt).slice(0, 8), 16);
}

function plantedGroup(rows, salt) {
  const planted = ordered(rows, `${salt}|order`);
  const entries = planted.map((row, position) => {
    const slot = position + 2;
    const left = 1 + (numericHash(`${salt}|left|${scheduleKey(row)}`) % 3);
    const right = 1 + (numericHash(`${salt}|right|${scheduleKey(row)}`) % 8);
    const predecessors = planted.slice(Math.max(0, position - 6), position);
    const count = Math.min(
      predecessors.length,
      numericHash(`${salt}|count|${scheduleKey(row)}`) % 3,
    );
    const requires = ordered(predecessors, `${salt}|requires|${scheduleKey(row)}`).slice(0, count);
    return {
      ...row,
      opens_at_query: Math.max(2, slot - left),
      closes_at_query: Math.min(31, slot + right),
      requires,
    };
  });
  if (entries.length >= 3) {
    // The urgent second record needs the first; taking the seemingly earlier
    // deadline on the third record spends the only query slot for that chain.
    const [predecessor, urgent, distractor] = entries;
    Object.assign(predecessor, { opens_at_query: 2, closes_at_query: 7, requires: [] });
    Object.assign(urgent, {
      opens_at_query: 3,
      closes_at_query: 3,
      requires: [{ entry_type: predecessor.entry_type, entry_id: predecessor.entry_id }],
    });
    Object.assign(distractor, { opens_at_query: 2, closes_at_query: 4, requires: [] });
  }
  return entries;
}

export function buildQuerySchedule(index, { pairSeed, family, nonce } = {}) {
  if (
    !Number.isSafeInteger(pairSeed) ||
    typeof family !== 'string' ||
    family.length === 0 ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0
  ) {
    throw new Error('v32 schedule generation requires pairSeed, family, and nonnegative nonce');
  }
  const { all, selectedKeys } = indexMembers(index);
  const current = all.filter((row) => selectedKeys.has(scheduleKey(row)));
  const archive = all.filter((row) => !selectedKeys.has(scheduleKey(row)));
  const salt = `v32|schedule|${pairSeed}|${family}|${nonce}`;
  return ordered(
    [...plantedGroup(current, `${salt}|current`), ...plantedGroup(archive, `${salt}|archive`)],
    `${salt}|catalog`,
  );
}

function validateSchedule(index) {
  const { all, allKeys, selectedKeys } = indexMembers(index);
  const indexOrder = new Map(all.map((row, position) => [scheduleKey(row), position]));
  const schedule = index.query_access_schedule;
  if (!Array.isArray(schedule) || schedule.length !== 60) {
    throw new Error('v32 schedule must cover all sixty indexed IDs');
  }
  const rows = new Map();
  for (const entry of schedule) {
    const key = scheduleKey(entry);
    if (rows.has(key)) {
      throw new Error(`v32 schedule duplicate ID ${key}`);
    }
    if (
      !allKeys.has(key) ||
      Object.keys(entry).length !== 5 ||
      !Number.isSafeInteger(entry.opens_at_query) ||
      !Number.isSafeInteger(entry.closes_at_query) ||
      entry.opens_at_query < 2 ||
      entry.closes_at_query > 31 ||
      entry.opens_at_query > entry.closes_at_query ||
      !Array.isArray(entry.requires) ||
      entry.requires.length > 2
    ) {
      throw new Error(`v32 schedule has malformed entry ${key}`);
    }
    rows.set(key, entry);
  }
  if (rows.size !== allKeys.size) {
    throw new Error('v32 schedule has missing indexed IDs');
  }
  for (const [key, entry] of rows) {
    const prerequisites = new Set();
    for (const required of entry.requires) {
      const requiredKey = scheduleKey(required);
      if (
        Object.keys(required).length !== 2 ||
        requiredKey === key ||
        !rows.has(requiredKey) ||
        prerequisites.has(requiredKey)
      ) {
        throw new Error(`v32 schedule has invalid prerequisite for ${key}`);
      }
      if (selectedKeys.has(key) && !selectedKeys.has(requiredKey)) {
        throw new Error(`v32 current detail requires archive record ${requiredKey}`);
      }
      prerequisites.add(requiredKey);
    }
  }
  const selected = [...rows]
    .filter(([key]) => selectedKeys.has(key))
    .map(([key, entry]) => ({ key, entry, indexOrder: indexOrder.get(key) }));
  return selected;
}

export function canQueryDetail(schedule, type, id, ordinal, successfulReads) {
  const key = scheduleKey({ entry_type: type, entry_id: id });
  if (
    !Array.isArray(schedule) ||
    !Number.isSafeInteger(ordinal) ||
    !(successfulReads instanceof Set)
  ) {
    throw new Error('v32 detail gate requires schedule, ordinal, and successful-read set');
  }
  const entry = schedule.find((item) => scheduleKey(item) === key);
  return (
    entry !== undefined &&
    entry.opens_at_query <= ordinal &&
    ordinal <= entry.closes_at_query &&
    entry.requires.every((required) => successfulReads.has(scheduleKey(required)))
  );
}

function prepare(index) {
  const tasks = validateSchedule(index);
  const byKey = new Map(tasks.map((task, position) => [task.key, position]));
  return tasks.map((task) => ({
    ...task,
    mask: 1 << byKey.get(task.key),
    prerequisites: task.entry.requires.reduce(
      (mask, required) => mask | (1 << byKey.get(scheduleKey(required))),
      0,
    ),
  }));
}

function compareByPolicy(policy, left, right) {
  if (policy === 'lexicographic') {
    return left.key.localeCompare(right.key);
  }
  if (policy === 'earliest-deadline') {
    return (
      left.entry.closes_at_query - right.entry.closes_at_query || left.key.localeCompare(right.key)
    );
  }
  if (policy === 'earliest-opening') {
    return (
      left.entry.opens_at_query - right.entry.opens_at_query || left.key.localeCompare(right.key)
    );
  }
  if (policy === 'topological') {
    return (
      left.entry.requires.length - right.entry.requires.length || left.indexOrder - right.indexOrder
    );
  }
  return left.indexOrder - right.indexOrder;
}

function search(index, policy) {
  const tasks = prepare(index);
  if (policy !== null && !POLICIES.has(policy)) {
    throw new Error(`v32 unknown greedy policy ${policy}`);
  }
  const allMask = (1 << tasks.length) - 1;
  const failed = new Set();
  const walk = (mask, order) => {
    if (mask === allMask) {
      return order;
    }
    if (policy === null && failed.has(mask)) {
      return null;
    }
    const ordinal = order.length + 2;
    const pending = tasks.filter((task) => (mask & task.mask) === 0);
    if (pending.some((task) => task.entry.closes_at_query < ordinal)) {
      failed.add(mask);
      return null;
    }
    for (let boundary = ordinal; boundary <= 31; boundary += 1) {
      if (
        pending.filter((task) => task.entry.closes_at_query <= boundary).length >
        boundary - ordinal + 1
      ) {
        failed.add(mask);
        return null;
      }
    }
    const choices = pending
      .filter(
        (task) =>
          task.entry.opens_at_query <= ordinal &&
          ordinal <= task.entry.closes_at_query &&
          (task.prerequisites & mask) === task.prerequisites,
      )
      .sort((left, right) => compareByPolicy(policy ?? 'earliest-deadline', left, right));
    for (const task of policy === null ? choices : choices.slice(0, 1)) {
      const result = walk(mask | task.mask, [...order, task.entry]);
      if (result) {
        return result;
      }
    }
    failed.add(mask);
    return null;
  };
  const result = walk(0, []);
  return result?.map(({ entry_type, entry_id }) => ({ entry_type, entry_id })) ?? null;
}

export function solveQuerySchedule(index) {
  return search(index, null);
}

export function greedyQuerySchedule(index, policy) {
  return search(index, policy);
}
