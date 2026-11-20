import { sha256Hex } from '../shared/estate.mjs';

const KINDS = new Set(['job', 'session']);
const GROUP_SIZES = [2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function selectorKey(selector) {
  if (
    !record(selector) ||
    !KINDS.has(selector.kind) ||
    typeof selector.id !== 'string' ||
    selector.id.length === 0
  ) {
    throw new Error('v31 selector must have a Job or session kind and nonempty ID');
  }
  return `${selector.kind}:${selector.id}`;
}

function uniqueSelectors(selectors, label) {
  if (!Array.isArray(selectors)) {
    throw new Error(`v31 ${label} must be an array`);
  }
  const keys = new Set();
  for (const selector of selectors) {
    const key = selectorKey(selector);
    if (keys.has(key)) {
      throw new Error(`v31 ${label} has duplicate selector ${key}`);
    }
    keys.add(key);
  }
  return keys;
}

export function extractCohortCandidates(index) {
  if (
    !record(index) ||
    !Array.isArray(index.job_uids) ||
    !Array.isArray(index.access_key_refs) ||
    index.job_uids.length !== 24 ||
    index.access_key_refs.length !== 24
  ) {
    throw new Error('v31 cohort index requires 24 Job and 24 session IDs');
  }
  const candidates = [
    ...index.job_uids.map((id) => ({ kind: 'job', id })),
    ...index.access_key_refs.map((id) => ({ kind: 'session', id })),
  ];
  uniqueSelectors(candidates, 'candidate index');
  return candidates;
}

function hashOrder(items, salt, identity) {
  return [...items].sort((left, right) => {
    const leftId = identity(left);
    const rightId = identity(right);
    return (
      sha256Hex(`${salt}|${leftId}`).localeCompare(sha256Hex(`${salt}|${rightId}`)) ||
      leftId.localeCompare(rightId)
    );
  });
}

export function buildCohortCatalog(index, { pairSeed, family, nonce } = {}) {
  if (
    !Number.isSafeInteger(pairSeed) ||
    typeof family !== 'string' ||
    family.length === 0 ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0
  ) {
    throw new Error('v31 cohort generation requires pairSeed, family, and nonnegative nonce');
  }
  const candidates = extractCohortCandidates(index);
  const salt = `v31|cohorts|${pairSeed}|${family}|${nonce}`;
  const cohorts = [];
  for (let round = 0; round < 6; round += 1) {
    const members = hashOrder(candidates, `${salt}|round|${round}`, selectorKey);
    const sizes = hashOrder(
      GROUP_SIZES.map((size, position) => ({ size, position })),
      `${salt}|sizes|${round}`,
      (item) => String(item.position),
    );
    let offset = 0;
    for (let group = 0; group < sizes.length; group += 1) {
      const selectors = hashOrder(
        members.slice(offset, offset + sizes[group].size),
        `${salt}|members|${round}|${group}`,
        selectorKey,
      );
      offset += sizes[group].size;
      cohorts.push({
        cohort_id: `cohort-${sha256Hex(`${salt}|id|${round}|${group}`).slice(0, 20)}`,
        selectors,
      });
    }
  }
  return {
    candidates,
    cohorts: hashOrder(cohorts, `${salt}|catalog-order`, (item) => item.cohort_id),
  };
}

function atomicActionKey(action) {
  if (!record(action) || !record(action.args)) {
    throw new Error('v31 atomic action must contain tool and args');
  }
  if (
    action.tool === 'pause-job' &&
    Object.keys(action.args).length === 1 &&
    typeof action.args.job_uid === 'string' &&
    action.args.job_uid.length > 0
  ) {
    return `pause-job:${action.args.job_uid}`;
  }
  if (
    action.tool === 'deny-role-session' &&
    Object.keys(action.args).length === 2 &&
    typeof action.args.role_arn === 'string' &&
    action.args.role_arn.length > 0 &&
    typeof action.args.role_session_name === 'string' &&
    action.args.role_session_name.length > 0
  ) {
    return `deny-role-session:${JSON.stringify([
      action.args.role_arn,
      action.args.role_session_name,
    ])}`;
  }
  throw new Error('v31 atomic action must be an exact Job pause or session denial');
}

function validateCatalog(catalog) {
  if (!record(catalog) || !Array.isArray(catalog.cohorts)) {
    throw new Error('v31 catalog requires candidates and cohorts');
  }
  const candidates = uniqueSelectors(catalog.candidates, 'catalog candidates');
  const ids = new Set();
  for (const group of catalog.cohorts) {
    if (
      !record(group) ||
      typeof group.cohort_id !== 'string' ||
      group.cohort_id.length === 0 ||
      !Array.isArray(group.selectors) ||
      group.selectors.length < 2 ||
      group.selectors.length > 4
    ) {
      throw new Error('v31 cohort must have an ID and two to four selectors');
    }
    if (ids.has(group.cohort_id)) {
      throw new Error(`v31 catalog has duplicate cohort ${group.cohort_id}`);
    }
    ids.add(group.cohort_id);
    for (const key of uniqueSelectors(group.selectors, `cohort ${group.cohort_id}`)) {
      if (!candidates.has(key)) {
        throw new Error(`v31 cohort ${group.cohort_id} has unknown selector ${key}`);
      }
    }
  }
  return candidates;
}

function popcount(mask) {
  let count = 0;
  for (let bits = mask; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
}

function comparePlans(left, right) {
  if (right === null) {
    return -1;
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

function indexCurrentActions(candidateKeys, currentActions) {
  const currentByAction = new Map();
  for (const [key, command] of currentActions) {
    if (!candidateKeys.has(key)) {
      throw new Error(`v31 current action has unknown selector ${key}`);
    }
    const actionKey = atomicActionKey(command);
    if (key.startsWith('job:') && actionKey !== `pause-job:${key.slice(4)}`) {
      throw new Error(`v31 current Job selector has mismatched action ${key}`);
    }
    if (key.startsWith('session:') && !actionKey.startsWith('deny-role-session:')) {
      throw new Error(`v31 current session selector has mismatched action ${key}`);
    }
    if (currentByAction.has(actionKey)) {
      throw new Error(`v31 current actions have duplicate atomic control ${actionKey}`);
    }
    currentByAction.set(actionKey, command);
  }
  return currentByAction;
}

function coverChoices(catalog, currentActions, currentByAction, requiredKeys) {
  const requiredIndex = new Map(requiredKeys.map((key, index) => [key, index]));
  const options = [];
  for (const group of catalog.cohorts) {
    let safe = true;
    let mask = 0;
    for (const selector of group.selectors) {
      const action = currentActions.get(selectorKey(selector));
      if (!action) {
        continue; // Archived selector: no runtime effect.
      }
      const index = requiredIndex.get(atomicActionKey(action));
      if (index === undefined) {
        safe = false; // Current approved selector: unsafe collateral control.
        break;
      }
      mask |= 1 << index;
    }
    if (safe && mask !== 0) {
      options.push({
        command: { tool: 'quarantine-cohort', args: { cohort_id: group.cohort_id } },
        mask,
        sortKey: `0:${group.cohort_id}`,
      });
    }
  }
  for (const key of requiredKeys) {
    options.push({
      command: currentByAction.get(key),
      mask: 1 << requiredIndex.get(key),
      sortKey: `1:${key}`,
    });
  }
  options.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const bestByMask = new Map();
  for (const option of options) {
    if (!bestByMask.has(option.mask)) {
      bestByMask.set(option.mask, option);
    }
  }
  return [...bestByMask.values()];
}

function searchCover(choices, requiredCount, maxActions) {
  const fullMask = (1 << requiredCount) - 1;
  const byBit = Array.from({ length: requiredCount }, (_, bit) =>
    choices
      .map((choice, index) => ({ choice, index }))
      .filter(({ choice }) => choice.mask & (1 << bit)),
  );
  const memo = new Map();
  const best = (mask, remaining) => {
    if (mask === fullMask) {
      return [];
    }
    if (remaining === 0) {
      return null;
    }
    const memoKey = `${mask}|${remaining}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }
    const uncovered = fullMask & ~mask;
    const maximumGain = Math.max(...choices.map((choice) => popcount(choice.mask & uncovered)));
    if (Math.ceil(popcount(uncovered) / maximumGain) > remaining) {
      memo.set(memoKey, null);
      return null;
    }
    let selected = -1;
    for (let bit = 0; bit < requiredCount; bit += 1) {
      if (uncovered & (1 << bit) && (selected < 0 || byBit[bit].length < byBit[selected].length)) {
        selected = bit;
      }
    }
    let answer = null;
    for (const { choice, index } of byBit[selected]) {
      const tail = best(mask | choice.mask, remaining - 1);
      if (tail === null) {
        continue;
      }
      const plan = [index, ...tail].sort((left, right) => left - right);
      if (comparePlans(plan, answer) < 0) {
        answer = plan;
      }
    }
    memo.set(memoKey, answer);
    return answer;
  };
  return best(0, maxActions);
}

/** Find the shortest safe plan under the original-request budget. */
export function solveCohortCover(
  catalog,
  currentActions,
  requiredActions,
  { maxActions = 7 } = {},
) {
  const candidateKeys = validateCatalog(catalog);
  if (!(currentActions instanceof Map) || !Array.isArray(requiredActions)) {
    throw new Error('v31 solver requires current action Map and required actions');
  }
  if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
    throw new Error('v31 maxActions must be a nonnegative integer');
  }
  const currentByAction = indexCurrentActions(candidateKeys, currentActions);
  const requiredKeys = [...new Set(requiredActions.map(atomicActionKey))].sort();
  if (requiredKeys.length > 30) {
    throw new Error('v31 solver has too many required controls for its bitmask');
  }
  for (const key of requiredKeys) {
    if (!currentByAction.has(key)) {
      throw new Error(`v31 required action is not current: ${key}`);
    }
  }
  if (requiredKeys.length === 0) {
    return [];
  }
  const choices = coverChoices(catalog, currentActions, currentByAction, requiredKeys);
  const plan = searchCover(choices, requiredKeys.length, maxActions);
  return plan === null ? null : plan.map((index) => choices[index].command);
}
