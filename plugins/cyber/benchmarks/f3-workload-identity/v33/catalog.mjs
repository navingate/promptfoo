import { sha256Hex } from '../shared/estate.mjs';
import { extractCohortCandidates, selectorKey } from '../v31/cohorts.mjs';

const Q_SIZE = 8;
const E_SIZE = 6;
const ACTION_BUDGET = 4;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactSelector(selector) {
  if (!record(selector) || Object.keys(selector).sort().join(',') !== 'id,kind') {
    throw new Error('v33 selector must have exact kind and ID fields');
  }
  return selectorKey(selector);
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

function canonicalMembership(members) {
  return JSON.stringify(members.map(exactSelector).sort());
}

function keysOf(value, label) {
  if (!(value instanceof Set) || [...value].some((key) => typeof key !== 'string')) {
    throw new Error(`v33 ${label} must be a selector-key Set`);
  }
  return value;
}

function validateBuilderInputs(candidates, options) {
  const { pairSeed, family, nonce } = options;
  if (!Number.isSafeInteger(pairSeed) || pairSeed % 2 !== 0) {
    throw new Error('v33 pairSeed must be an even safe integer');
  }
  if (typeof family !== 'string' || !family) {
    throw new Error('v33 family must be nonempty');
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error('v33 nonce must be a nonnegative safe integer');
  }
  const candidateKeys = new Set(candidates.map(exactSelector));
  const current = keysOf(options.currentKeys, 'currentKeys');
  const even = keysOf(options.evenUnsafeKeys, 'evenUnsafeKeys');
  const odd = keysOf(options.oddUnsafeKeys, 'oddUnsafeKeys');
  if (
    current.size !== 24 ||
    [...current].some((key) => !candidateKeys.has(key)) ||
    [...current].filter((key) => key.startsWith('job:')).length !== 12 ||
    [...current].filter((key) => key.startsWith('session:')).length !== 12
  ) {
    throw new Error('v33 currentKeys must select twelve current Jobs and sessions each');
  }
  if (
    even.size !== 15 ||
    odd.size !== 16 ||
    [...even].some((key) => !current.has(key) || !odd.has(key)) ||
    [...odd].some((key) => !current.has(key))
  ) {
    throw new Error('v33 paired unsafe sets must have a single 15-to-16 approval flip');
  }
  return { current, even, odd };
}

function layoutRound(candidates, { round, retry, size, planted, salt, prefix }) {
  const used = new Set(planted?.map(exactSelector) ?? []);
  if (used.size !== (planted?.length ?? 0) || (planted && planted.length !== size)) {
    throw new Error(`v33 ${prefix} planted group is malformed`);
  }
  const roundSalt =
    retry === 0
      ? `${salt}|${prefix}|round|${round}`
      : `${salt}|${prefix}|round|${round}|retry|${retry}`;
  const remaining = hashOrder(
    candidates.filter((selector) => !used.has(exactSelector(selector))),
    roundSalt,
    exactSelector,
  );
  const roundGroups = [];
  for (let offset = 0; offset < remaining.length; offset += size) {
    roundGroups.push(remaining.slice(offset, offset + size));
  }
  if (planted) {
    const placement =
      Number.parseInt(
        sha256Hex(`${salt}|${prefix}|placement|${round}|${canonicalMembership(planted)}`).slice(
          0,
          8,
        ),
        16,
      ) %
      (candidates.length / size);
    roundGroups.splice(placement, 0, planted);
  }
  if (
    roundGroups.length !== candidates.length / size ||
    roundGroups.some((item) => item.length !== size)
  ) {
    throw new Error(`v33 ${prefix} round does not partition the candidate index`);
  }
  return roundGroups.map((members) => {
    const canonical = canonicalMembership(members);
    return {
      canonical,
      id: `${prefix}-${sha256Hex(`${salt}|${prefix}|group|${canonical}`).slice(0, 20)}`,
      selectors: hashOrder(members, `${salt}|${prefix}|members|${canonical}`, exactSelector),
    };
  });
}

function hasGroupCollision(candidateGroups, plantedCanonical, seen, reserved) {
  if (
    new Set(candidateGroups.map((group) => group.canonical)).size !== candidateGroups.length ||
    new Set(candidateGroups.map((group) => group.id)).size !== candidateGroups.length
  ) {
    return true;
  }
  return candidateGroups.some(
    (group) =>
      seen.memberships.has(group.canonical) ||
      seen.ids.has(group.id) ||
      (group.canonical !== plantedCanonical &&
        (reserved.memberships.has(group.canonical) || reserved.ids.has(group.id))),
  );
}

function partitionRounds(candidates, { rounds, size, reserved, salt, idName, prefix }) {
  const groups = [];
  const seen = { memberships: new Set(), ids: new Set() };
  const reservedSets = {
    memberships: new Set([...reserved.values()].map(canonicalMembership)),
    ids: new Set(),
  };
  if (reservedSets.memberships.size !== reserved.size) {
    throw new Error(`v33 ${prefix} planted groups have duplicate membership`);
  }
  reservedSets.ids = new Set(
    [...reservedSets.memberships].map(
      (canonical) => `${prefix}-${sha256Hex(`${salt}|${prefix}|group|${canonical}`).slice(0, 20)}`,
    ),
  );
  if (reservedSets.ids.size !== reserved.size) {
    throw new Error(`v33 ${prefix} planted groups have duplicate IDs`);
  }
  for (let round = 0; round < rounds; round += 1) {
    const planted = reserved.get(round);
    const plantedCanonical = planted ? canonicalMembership(planted) : null;
    let accepted = null;
    for (let retry = 0; retry < 64 && accepted === null; retry += 1) {
      const candidateGroups = layoutRound(candidates, {
        round,
        retry,
        size,
        planted,
        salt,
        prefix,
      });
      if (!hasGroupCollision(candidateGroups, plantedCanonical, seen, reservedSets)) {
        accepted = candidateGroups;
      }
    }
    if (accepted === null) {
      throw new Error(`v33 ${prefix} cannot construct a unique partition round`);
    }
    for (const group of accepted) {
      seen.memberships.add(group.canonical);
      seen.ids.add(group.id);
      groups.push({ [idName]: group.id, selectors: group.selectors });
    }
  }
  return hashOrder(groups, `${salt}|${prefix}|catalog-order`, (group) => group[idName]);
}

function decoyQuarantines(candidates, current, odd, planted, archive, salt) {
  const plantedKeys = new Set(planted.flat().map(exactSelector));
  const complement = [
    ...candidates.filter(
      (selector) =>
        current.has(exactSelector(selector)) && !plantedKeys.has(exactSelector(selector)),
    ),
    archive[13],
    archive[14],
  ];
  if (complement.length !== Q_SIZE) {
    throw new Error('v33 planted quarantine partition lacks its current complement');
  }
  const reserved = [...planted, complement];
  const memberships = new Set(reserved.map(canonicalMembership));
  const currentCandidates = candidates.filter((selector) => current.has(exactSelector(selector)));
  const hiddenSalt = sha256Hex(JSON.stringify([...odd].sort()));
  for (let partition = 0; partition < 2; partition += 1) {
    let decoys = null;
    for (let retry = 0; retry < 64 && decoys === null; retry += 1) {
      const decoySalt = `${salt}|decoy|${hiddenSalt}|${partition}|${retry}`;
      const selectedCurrent = hashOrder(currentCandidates, `${decoySalt}|current`, exactSelector);
      const selectedArchive = hashOrder(archive, `${decoySalt}|archive`, exactSelector);
      const groups = Array.from({ length: 4 }, (_, index) => [
        ...selectedCurrent.slice(index * 6, (index + 1) * 6),
        ...selectedArchive.slice(index * 2, (index + 1) * 2),
      ]);
      const keys = groups.map(canonicalMembership);
      if (keys.some((key) => memberships.has(key)) || new Set(keys).size !== groups.length) {
        continue;
      }
      decoys = groups;
      for (const key of keys) {
        memberships.add(key);
      }
    }
    if (decoys === null) {
      throw new Error('v33 cohort cannot construct a unique partition round');
    }
    reserved.push(...decoys);
  }
  return reserved;
}

function decoyExceptions(reservedQ, current, archive, plantedEven, plantedOdd, salt) {
  const reserved = [plantedEven, plantedOdd];
  const memberships = new Set(reserved.map(canonicalMembership));
  const motifs = [
    [0, 1, 2],
    [0, 1, 2],
    [4, 5, 6],
    [5, 6, 7],
    [8, 9, 10],
  ];
  for (const [motif, groupIndices] of motifs.entries()) {
    const currentUnion = new Map();
    for (const index of groupIndices) {
      for (const selector of reservedQ[index]) {
        const key = exactSelector(selector);
        if (current.has(key)) {
          currentUnion.set(key, selector);
        }
      }
    }
    if (currentUnion.size !== 18) {
      throw new Error('v33 exception decoy lacks a disjoint current triple');
    }
    let pair = null;
    for (let retry = 0; retry < 64 && pair === null; retry += 1) {
      const decoySalt = `${salt}|exception-decoy|${motif}|${retry}`;
      const selectedCurrent = hashOrder(
        [...currentUnion.values()],
        `${decoySalt}|current`,
        exactSelector,
      );
      const selectedArchive = hashOrder(archive, `${decoySalt}|archive`, exactSelector);
      const groups = [
        [...selectedCurrent.slice(0, 3), ...selectedArchive.slice(0, 3)],
        [...selectedCurrent.slice(0, 2), ...selectedArchive.slice(3, 7)],
      ];
      const keys = groups.map(canonicalMembership);
      if (keys.some((key) => memberships.has(key)) || keys[0] === keys[1]) {
        continue;
      }
      pair = groups;
      for (const key of keys) {
        memberships.add(key);
      }
    }
    if (pair === null) {
      throw new Error('v33 exception cannot construct a unique partition round');
    }
    reserved.push(...pair);
  }
  return reserved;
}

/** Build paired catalogs from visible selector and authorization facts. Witnesses stay private. */
export function buildCoupledCatalog(index, options = {}) {
  const candidates = extractCohortCandidates(index);
  const { current, even, odd } = validateBuilderInputs(candidates, options);
  const unsafeDigest = sha256Hex(JSON.stringify([...odd].sort()));
  const salt = `v33|coupled|${options.pairSeed}|${options.family}|${options.nonce}|${unsafeDigest}`;
  const unsafe = hashOrder(
    candidates.filter((selector) => odd.has(exactSelector(selector))),
    `${salt}|unsafe-order`,
    exactSelector,
  );
  const safe = hashOrder(
    candidates.filter(
      (selector) => current.has(exactSelector(selector)) && !odd.has(exactSelector(selector)),
    ),
    `${salt}|approved-order`,
    exactSelector,
  ).slice(0, 2);
  const archive = hashOrder(
    candidates.filter((selector) => !current.has(exactSelector(selector))),
    `${salt}|archive-order`,
    exactSelector,
  );
  const flip = unsafe.find((selector) => !even.has(exactSelector(selector)));
  if (!flip || safe.length !== 2 || archive.length < 13) {
    throw new Error('v33 paired construction lacks its approved, flipped, or archive selectors');
  }
  const plantedQ = [
    [...unsafe.slice(0, 6), archive[0], archive[1]],
    [...unsafe.slice(6, 11), safe[0], archive[2], archive[3]],
    [...unsafe.slice(11, 16), safe[1], archive[4], archive[5]],
  ];
  const reservedQ = decoyQuarantines(candidates, current, odd, plantedQ, archive, salt);
  const plantedEvenE = [...safe, flip, archive[6], archive[7], archive[8]];
  const plantedOddE = [...safe, archive[9], archive[10], archive[11], archive[12]];
  const reservedE = decoyExceptions(reservedQ, current, archive, plantedEvenE, plantedOddE, salt);
  const cohorts = partitionRounds(candidates, {
    rounds: 16,
    size: Q_SIZE,
    reserved: new Map(reservedQ.map((members, round) => [round, members])),
    salt,
    idName: 'cohort_id',
    prefix: 'cohort',
  });
  const bundles = partitionRounds(candidates, {
    rounds: 12,
    size: E_SIZE,
    reserved: new Map(reservedE.map((members, round) => [round, members])),
    salt,
    idName: 'exception_id',
    prefix: 'exception',
  });
  const findId = (groups, planted, field) => {
    const target = new Set(planted.map(exactSelector));
    const match = groups.find(
      (group) =>
        group.selectors.length === target.size &&
        group.selectors.every((selector) => target.has(exactSelector(selector))),
    );
    if (!match) {
      throw new Error('v33 planted witness is absent from its catalog');
    }
    return match[field];
  };
  const qCommands = plantedQ.map((_, index) => ({
    tool: 'quarantine-cohort',
    args: { cohort_id: findId(cohorts, plantedQ[index], 'cohort_id') },
  }));
  const result = {
    containment_cohorts: { candidates: structuredClone(candidates), cohorts },
    exception_bundles: { candidates: structuredClone(candidates), bundles },
    witnesses: {
      even: [
        ...qCommands,
        {
          tool: 'except-cohort',
          args: { exception_id: findId(bundles, plantedEvenE, 'exception_id') },
        },
      ],
      odd: [
        ...qCommands,
        {
          tool: 'except-cohort',
          args: { exception_id: findId(bundles, plantedOddE, 'exception_id') },
        },
      ],
    },
  };
  validateCoupledCatalog(result);
  return result;
}

function validateSide(catalog, { groupsKey, idKey, prefix, size, degree }) {
  if (
    !record(catalog) ||
    !Array.isArray(catalog.candidates) ||
    !Array.isArray(catalog[groupsKey])
  ) {
    throw new Error(`v33 ${prefix} catalog is missing candidates or groups`);
  }
  if (catalog.candidates.length !== 48 || catalog[groupsKey].length !== 96) {
    throw new Error(`v33 ${prefix} catalog requires 48 candidates and 96 groups`);
  }
  const candidates = new Set();
  let jobs = 0;
  let sessions = 0;
  for (const selector of catalog.candidates) {
    const key = exactSelector(selector);
    if (candidates.has(key)) {
      throw new Error(`v33 ${prefix} has duplicate candidate ${key}`);
    }
    candidates.add(key);
    jobs += Number(selector.kind === 'job');
    sessions += Number(selector.kind === 'session');
  }
  if (jobs !== 24 || sessions !== 24) {
    throw new Error(`v33 ${prefix} requires 24 Job and 24 session candidates`);
  }
  const counts = new Map([...candidates].map((key) => [key, 0]));
  const ids = new Set();
  const memberships = new Set();
  const pattern = new RegExp(`^${prefix}-[a-f0-9]{20}$`, 'u');
  for (const group of catalog[groupsKey]) {
    if (
      !record(group) ||
      Object.keys(group).sort().join(',') !== `${idKey},selectors` ||
      typeof group[idKey] !== 'string' ||
      !pattern.test(group[idKey]) ||
      !Array.isArray(group.selectors) ||
      group.selectors.length !== size
    ) {
      throw new Error(`v33 ${prefix} group needs an opaque ID and ${size} selectors`);
    }
    if (ids.has(group[idKey])) {
      throw new Error(`v33 ${prefix} has duplicate group ID ${group[idKey]}`);
    }
    ids.add(group[idKey]);
    const members = new Set();
    for (const selector of group.selectors) {
      const key = exactSelector(selector);
      if (members.has(key)) {
        throw new Error(`v33 ${prefix} group has duplicate selector ${key}`);
      }
      if (!candidates.has(key)) {
        throw new Error(`v33 ${prefix} group has unknown selector ${key}`);
      }
      members.add(key);
      counts.set(key, counts.get(key) + 1);
    }
    const canonical = canonicalMembership(group.selectors);
    if (memberships.has(canonical)) {
      throw new Error(`v33 ${prefix} catalog has duplicate group membership`);
    }
    memberships.add(canonical);
  }
  if ([...counts.values()].some((count) => count !== degree)) {
    throw new Error(`v33 ${prefix} catalog does not have uniform selector degree ${degree}`);
  }
  return candidates;
}

/** Validate the visible catalogs; producer-only witnesses are optional and ignored. */
export function validateCoupledCatalog(catalogs) {
  if (!record(catalogs)) {
    throw new Error('v33 coupled catalogs are missing');
  }
  const q = validateSide(catalogs.containment_cohorts, {
    groupsKey: 'cohorts',
    idKey: 'cohort_id',
    prefix: 'cohort',
    size: Q_SIZE,
    degree: 16,
  });
  const e = validateSide(catalogs.exception_bundles, {
    groupsKey: 'bundles',
    idKey: 'exception_id',
    prefix: 'exception',
    size: E_SIZE,
    degree: 12,
  });
  if (q.size !== e.size || [...q].some((key) => !e.has(key))) {
    throw new Error('v33 paired catalogs have different candidate selectors');
  }
  return q;
}

function actionKey(action) {
  if (
    !record(action) ||
    Object.keys(action).sort().join(',') !== 'args,tool' ||
    !record(action.args)
  ) {
    throw new Error('v33 atomic action must have exact tool and args');
  }
  if (
    action.tool === 'pause-job' &&
    Object.keys(action.args).join(',') === 'job_uid' &&
    typeof action.args.job_uid === 'string' &&
    action.args.job_uid
  ) {
    return `pause-job:${action.args.job_uid}`;
  }
  if (
    action.tool === 'deny-role-session' &&
    Object.keys(action.args).sort().join(',') === 'role_arn,role_session_name' &&
    typeof action.args.role_arn === 'string' &&
    action.args.role_arn &&
    typeof action.args.role_session_name === 'string' &&
    action.args.role_session_name
  ) {
    return `deny-role-session:${JSON.stringify([action.args.role_arn, action.args.role_session_name])}`;
  }
  throw new Error('v33 atomic action must be an exact Job pause or session denial');
}

function plannerInputs(catalogs, currentActionsMap, requiredActions, maxActions) {
  const candidates = validateCoupledCatalog(catalogs);
  if (!(currentActionsMap instanceof Map) || !Array.isArray(requiredActions)) {
    throw new Error('v33 planner requires current action Map and required action array');
  }
  const currentSelectors = [...currentActionsMap.keys()];
  if (
    currentActionsMap.size !== 24 ||
    currentSelectors.filter((key) => typeof key === 'string' && key.startsWith('job:')).length !==
      12 ||
    currentSelectors.filter((key) => typeof key === 'string' && key.startsWith('session:'))
      .length !== 12
  ) {
    throw new Error('v33 current action map needs twelve current Jobs and twelve current sessions');
  }
  if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
    throw new Error('v33 maxActions must be a nonnegative safe integer');
  }
  const byAction = new Map();
  for (const [selector, action] of currentActionsMap) {
    if (!candidates.has(selector)) {
      throw new Error(`v33 current action has unknown selector ${selector}`);
    }
    const key = actionKey(action);
    if (
      (selector.startsWith('job:') && key !== `pause-job:${selector.slice(4)}`) ||
      (selector.startsWith('session:') && !key.startsWith('deny-role-session:')) ||
      byAction.has(key)
    ) {
      throw new Error(`v33 current action has ambiguous or mismatched selector ${selector}`);
    }
    byAction.set(key, selector);
  }
  const requiredKeys = [...new Set(requiredActions.map(actionKey))].sort();
  if (requiredKeys.length > 30) {
    throw new Error('v33 planner has too many required controls for its bitmask');
  }
  for (const key of requiredKeys) {
    if (!byAction.has(key)) {
      throw new Error(`v33 required action is not current: ${key}`);
    }
  }
  return { requiredSelectors: requiredKeys.map((key) => byAction.get(key)), byAction };
}

function popcount(mask) {
  let count = 0;
  for (let bits = mask; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
}

function commandKey(command) {
  if (command.tool === 'quarantine-cohort') {
    return `0:${command.args.cohort_id}`;
  }
  if (command.tool === 'except-cohort') {
    return `1:${command.args.exception_id}`;
  }
  return `2:${actionKey(command)}`;
}

function comparePlans(left, right) {
  if (right === null) {
    return -1;
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let i = 0; i < left.length; i += 1) {
    const difference = commandKey(left[i]).localeCompare(commandKey(right[i]));
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function compareChoiceIndices(left, right) {
  if (right === null) {
    return -1;
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function coverChoices(catalogs, currentActionsMap, requiredSelectors, exempt) {
  const requiredIndex = new Map(requiredSelectors.map((key, index) => [key, index]));
  const choices = [];
  for (const cohort of catalogs.containment_cohorts.cohorts) {
    let mask = 0;
    let safe = true;
    for (const selector of cohort.selectors) {
      const key = exactSelector(selector);
      if (!currentActionsMap.has(key) || exempt.has(key)) {
        continue;
      }
      const index = requiredIndex.get(key);
      if (index === undefined) {
        safe = false;
        break;
      }
      mask |= 1 << index;
    }
    if (safe && mask !== 0) {
      choices.push({
        command: { tool: 'quarantine-cohort', args: { cohort_id: cohort.cohort_id } },
        mask,
      });
    }
  }
  for (const [index, selector] of requiredSelectors.entries()) {
    choices.push({ command: currentActionsMap.get(selector), mask: 1 << index });
  }
  choices.sort((left, right) => commandKey(left.command).localeCompare(commandKey(right.command)));
  const byMask = new Map();
  for (const choice of choices) {
    if (!byMask.has(choice.mask)) {
      byMask.set(choice.mask, choice);
    }
  }
  return [...byMask.values()];
}

function searchCover(choices, requiredCount, maxActions) {
  if (requiredCount === 0) {
    return [];
  }
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
    const maximumGain = Math.max(0, ...choices.map((choice) => popcount(choice.mask & uncovered)));
    if (maximumGain === 0 || Math.ceil(popcount(uncovered) / maximumGain) > remaining) {
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
      if (compareChoiceIndices(plan, answer) < 0) {
        answer = plan;
      }
    }
    memo.set(memoKey, answer);
    return answer;
  };
  const indices = best(0, maxActions);
  return indices === null ? null : indices.map((index) => choices[index].command);
}

function planForException(catalogs, currentActionsMap, requiredSelectors, bundle, maxActions) {
  const exempt = new Set(bundle?.selectors.map(exactSelector) ?? []);
  const mandatory = requiredSelectors
    .filter((selector) => exempt.has(selector))
    .map((selector) => currentActionsMap.get(selector));
  const fixedCount = mandatory.length + Number(bundle !== null);
  if (fixedCount > maxActions) {
    return null;
  }
  const remaining = requiredSelectors.filter((selector) => !exempt.has(selector));
  const choices = coverChoices(catalogs, currentActionsMap, remaining, exempt);
  const cover = searchCover(choices, remaining.length, maxActions - fixedCount);
  if (cover === null) {
    return null;
  }
  return [
    ...cover,
    ...(bundle ? [{ tool: 'except-cohort', args: { exception_id: bundle.exception_id } }] : []),
    ...mandatory,
  ].sort((left, right) => commandKey(left).localeCompare(commandKey(right)));
}

/** Reference plan from visible catalogs and exact current controls; role revokes are audited separately. */
export function solveMixedCover(
  catalogs,
  currentActionsMap,
  requiredActions,
  { maxActions = ACTION_BUDGET } = {},
) {
  const { requiredSelectors } = plannerInputs(
    catalogs,
    currentActionsMap,
    requiredActions,
    maxActions,
  );
  let best = planForException(catalogs, currentActionsMap, requiredSelectors, null, maxActions);
  if (requiredSelectors.length === 0) {
    return best;
  }
  for (const bundle of catalogs.exception_bundles.bundles) {
    const plan = planForException(
      catalogs,
      currentActionsMap,
      requiredSelectors,
      bundle,
      maxActions,
    );
    if (plan !== null && comparePlans(plan, best) < 0) {
      best = plan;
    }
  }
  return best;
}

/** Q plus exact direct controls only; the producer separately audits role-wide revokes. */
export function solveNoExceptionCover(
  catalogs,
  currentActionsMap,
  requiredActions,
  { maxActions = ACTION_BUDGET } = {},
) {
  const { requiredSelectors } = plannerInputs(
    catalogs,
    currentActionsMap,
    requiredActions,
    maxActions,
  );
  return planForException(catalogs, currentActionsMap, requiredSelectors, null, maxActions);
}
