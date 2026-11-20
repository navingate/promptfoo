import { sha256Hex } from '../shared/estate.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { greedyQuerySchedule, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { resolvePrefix } from './prefix.mjs';

const GREEDY_POLICIES = [
  'index',
  'lexicographic',
  'earliest-deadline',
  'earliest-opening',
  'topological',
];
const read = { credential: querySource, job: queryWorkload, session: querySession };

function detailReplies(visible, order) {
  return new Map(
    order.map((row) => {
      const evidence = read[row.entry_type](visible, row.entry_id);
      if (!evidence || evidence.archive) {
        throw new Error('v35 missing current detail ' + scheduleKey(row));
      }
      return [scheduleKey(row), { ok: true, evidence }];
    }),
  );
}

export function retimeLastJob(schedule, lastJobKey) {
  return schedule.map((row) => {
    if (scheduleKey(row) === lastJobKey) {
      return { ...row, opens_at_query: 31, closes_at_query: 31 };
    }
    return { ...row, requires: row.requires.filter((req) => scheduleKey(req) !== lastJobKey) };
  });
}

// Explore alternate windows over the same prerequisite graph. Shift each window
// by its record's change in position in a feasible topological order. The
// public solver still has to recover an order and pass the prefix gates.
function alternativeWindows(schedule, original, lastJobKey, nonce) {
  const positions = new Map(original.map((row, i) => [scheduleKey(row), i + 2]));
  const rows = schedule.filter(
    (row) => positions.has(scheduleKey(row)) && scheduleKey(row) !== lastJobKey,
  );
  const ranked = rows
    .map((row) => ({
      row,
      rank: sha256Hex('v35|schedule|' + nonce + '|' + scheduleKey(row)),
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank));
  // Recreate V32's three-slot deadline trap using an existing prerequisite.
  // The urgent record's only predecessor must go first, although a different
  // open record has an earlier deadline. Never introduce a prerequisite.
  const roots = new Set(
    ranked.filter(({ row }) => !row.requires.length).map(({ row }) => scheduleKey(row)),
  );
  const urgent = ranked.find(
    ({ row }) => row.requires.length === 1 && roots.has(scheduleKey(row.requires[0])),
  );
  const first = urgent && scheduleKey(urgent.row.requires[0]);
  const third = [...roots].find((key) => key !== first);
  const trap = new Map();
  if (urgent && third) {
    trap.set(first, [2, 7]);
    trap.set(scheduleKey(urgent.row), [3, 3]);
    trap.set(third, [2, 4]);
    const front = [...trap.keys()].map(
      (key) =>
        ranked.splice(
          ranked.findIndex(({ row }) => scheduleKey(row) === key),
          1,
        )[0],
    );
    ranked.unshift(...front);
  }
  const shifts = new Map();
  while (ranked.length) {
    const at = ranked.findIndex(({ row }) => row.requires.every((r) => shifts.has(scheduleKey(r))));
    if (at < 0) {
      throw new Error('v35 schedule contains a prerequisite cycle');
    }
    const [{ row }] = ranked.splice(at, 1);
    const key = scheduleKey(row);
    shifts.set(key, shifts.size + 2 - positions.get(key));
  }
  return schedule.map((row) => {
    const window = trap.get(scheduleKey(row));
    if (window) {
      return { ...row, opens_at_query: window[0], closes_at_query: window[1] };
    }
    const shift = shifts.get(scheduleKey(row));
    if (!shift) {
      return row;
    }
    return {
      ...row,
      opens_at_query: Math.max(2, row.opens_at_query + shift),
      closes_at_query: Math.min(31, row.closes_at_query + shift),
    };
  });
}

function checkPrefix(index, even, odd, order, lastJobKey, activeKey) {
  const keys = order.map(scheduleKey);
  if (keys.length !== 30 || keys.at(-1) !== lastJobKey) {
    return null;
  }
  const transcript = keys.map((key) => even.get(key));
  const checkpoints = {};
  // Every detail except the last has already passed paired byte equality.
  for (const ordinal of [20, 24, 30]) {
    const prefix = resolvePrefix(index, transcript.slice(0, ordinal - 1));
    const rows = Object.values(prefix);
    const unsafe = rows.filter((row) => row.status === 'unsafe').length;
    const approved = rows.filter((row) => row.status === 'approved').length;
    if (
      // Each of the first two catalog pools also needs its own approved spare.
      (ordinal === 20 && (unsafe < 6 || approved < 1)) ||
      (ordinal === 24 && (unsafe < 10 || approved < 4)) ||
      (ordinal === 30 &&
        (unsafe !== 15 ||
          approved !== 7 ||
          prefix[lastJobKey].status !== 'unresolved' ||
          prefix[activeKey].status !== 'unresolved'))
    ) {
      return null;
    }
    checkpoints[ordinal] = prefix;
  }
  const finalEven = resolvePrefix(index, transcript);
  const finalOdd = resolvePrefix(index, [...transcript.slice(0, -1), odd.get(lastJobKey)]);
  for (const [key, row] of Object.entries(finalEven)) {
    if (
      key === lastJobKey
        ? row.status !== 'approved' || finalOdd[key].status !== 'unsafe'
        : row.status === 'unresolved' || row.status !== finalOdd[key].status
    ) {
      throw new Error('v35 final reply must flip only the renewal Job authorization');
    }
  }
  if (finalEven[activeKey].status !== 'approved') {
    throw new Error('v35 final renewal Job has no approved paired active read');
  }
  return checkpoints;
}

/** Build a schedule from public query replies; retain the checkpoints only for catalog construction. */
export function buildPairedSchedule(even, odd) {
  const indices = [even, odd].map((v) => ({
    ...listWorkloads(v),
    query_access_schedule: v.query_access_schedule,
  }));
  if (JSON.stringify(indices[0]) !== JSON.stringify(indices[1])) {
    throw new Error('v35 paired workload index or query schedule differs');
  }
  const index = indices[0];
  const original = solveQuerySchedule(index);
  if (!original) {
    throw new Error('v35 inherited schedule is infeasible');
  }
  const [left, right] = [even, odd].map((v) => detailReplies(v, original));
  const differing = original.filter(
    (row) =>
      JSON.stringify(left.get(scheduleKey(row))) !== JSON.stringify(right.get(scheduleKey(row))),
  );
  if (differing.length !== 1 || differing[0].entry_type !== 'job') {
    throw new Error('v35 pair requires exactly one differing workload reply');
  }
  const lastJobKey = scheduleKey(differing[0]);
  // Withhold just the flipped Job. The effective Pod→STS lineage identifies
  // which active read now lacks its Job, even if the partition has stale Pods.
  const beforeFlip = resolvePrefix(
    index,
    original
      .filter((row) => scheduleKey(row) !== lastJobKey)
      .map((row) => left.get(scheduleKey(row))),
  );
  const activeKeys = Object.keys(beforeFlip).filter(
    (key) =>
      key.startsWith('session:') && beforeFlip[key].missing_dependencies.includes(lastJobKey),
  );
  if (activeKeys.length !== 1) {
    throw new Error('v35 differing Job lacks a unique issued session');
  }
  const [activeKey] = activeKeys;
  const base = retimeLastJob(index.query_access_schedule, lastJobKey);
  for (let nonce = 0; nonce < 256; nonce += 1) {
    const schedule = nonce === 0 ? base : alternativeWindows(base, original, lastJobKey, nonce);
    const indexed = { ...index, query_access_schedule: schedule };
    const order = solveQuerySchedule(indexed);
    const checkpoints = order && checkPrefix(indexed, left, right, order, lastJobKey, activeKey);
    if (
      checkpoints &&
      GREEDY_POLICIES.every((policy) => greedyQuerySchedule(indexed, policy) === null)
    ) {
      return { schedule, checkpoints, lastJobKey, activeKey };
    }
  }
  throw new Error('v35 cannot construct a feasible final Job schedule with the required prefixes');
}

/** Replay both assembled consoles, including their catalogs, before returning either variant. */
export function verifyPairedConsole(sessions, step, proof) {
  if (JSON.stringify(sessions[0].initial) !== JSON.stringify(sessions[1].initial)) {
    throw new Error('v35 paired initial console packets differ');
  }
  const queryBoth = (tool, args) => {
    const replies = sessions.map((session) => step(session, { tool, args }));
    if (replies.some((reply) => !reply.ok || !reply.evidence || reply.evidence.archive)) {
      throw new Error('v35 paired console cannot retrieve scheduled ' + tool);
    }
    return replies;
  };
  const indices = queryBoth('list-workloads', {});
  const index = indices[0].evidence;
  if (
    JSON.stringify(indices[0]) !== JSON.stringify(indices[1]) ||
    JSON.stringify(index.query_access_schedule) !== JSON.stringify(proof.schedule)
  ) {
    throw new Error('v35 paired console index or schedule differs');
  }
  const order = solveQuerySchedule(index);
  if (order?.length !== 30 || scheduleKey(order.at(-1)) !== proof.lastJobKey) {
    throw new Error('v35 paired console cannot reach the final renewal Job');
  }
  const commands = {
    credential: ['query-source', 'credential_id'],
    job: ['query-workload', 'job_uid'],
    session: ['query-session', 'access_key_ref'],
  };
  const details = [new Map(), new Map()];
  for (const row of order) {
    const key = scheduleKey(row);
    const [tool, field] = commands[row.entry_type];
    const replies = queryBoth(tool, { [field]: row.entry_id });
    const differs = JSON.stringify(replies[0]) !== JSON.stringify(replies[1]);
    if (differs !== (key === proof.lastJobKey)) {
      throw new Error('v35 paired console must differ only on the final renewal Job');
    }
    for (const [i, reply] of replies.entries()) {
      details[i].set(key, reply);
    }
  }
  const actual = checkPrefix(
    index,
    details[0],
    details[1],
    order,
    proof.lastJobKey,
    proof.activeKey,
  );
  if (JSON.stringify(actual) !== JSON.stringify(proof.checkpoints)) {
    throw new Error('v35 paired console prefix evidence differs from the schedule proof');
  }
}
