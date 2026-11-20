import { createHmac, randomBytes } from 'node:crypto';

import { sha256Hex } from '../shared/estate.mjs';
import { extractCohortCandidates, selectorKey } from '../v31/cohorts.mjs';
import { chooseStagedException, chooseStagedQuarantine } from './staged_plan.mjs';

// Count distinct current pairs whose seven archive fillers can fit the same
// nine-selector pool. The three reserved pairs must draw independently enough to escape a single pool.
function hasConcentratedExceptions(pairs, archive, flip) {
  const bits = new Map(archive.map((key, i) => [key, 1 << i]));
  const byPool = new Map();
  for (const pair of pairs) {
    if (pair.keys.includes(flip) || new Set(pair.archive).size !== 7) {
      continue;
    }
    const mask = pair.archive.reduce((value, key) => value | bits.get(key), 0);
    const remaining = [...bits.values()].filter((bit) => (bit & mask) === 0);
    const currentPair = JSON.stringify([...pair.keys].sort());
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const pool = mask | remaining[i] | remaining[j];
        if (!byPool.has(pool)) {
          byPool.set(pool, new Set());
        }
        const members = byPool.get(pool);
        members.add(currentPair);
        if (members.size >= 3) {
          return true;
        }
      }
    }
  }
  return false;
}

function publicSequences(stages, pairs) {
  const sequences = [];
  const disjoint = (a, b) => a.keys.every((key) => !b.keys.includes(key));
  for (const first of stages[0]) {
    for (const second of stages[1]) {
      if (!disjoint(first, second)) {
        continue;
      }
      const candidates = pairs.filter((p) => p.keys.every((key) => second.keys.includes(key)));
      for (const third of stages[2]) {
        if (!disjoint(first, third) || !disjoint(second, third)) {
          continue;
        }
        sequences.push({ groups: [first, second, third], pairs: candidates });
      }
    }
  }
  return sequences;
}

// The published four-action and exception requirements eliminate a hypothetical
// labeling if ordinary Qs and direct controls can already cover it.
function hasShortCover(required, quarantines, exceptions) {
  const choices = [
    ...new Set(quarantines.filter((mask) => (mask & ~required) === 0 && popcount(mask) >= 2)),
  ].sort((a, b) => popcount(b) - popcount(a));
  function cover(todo, budget, start) {
    const size = popcount(todo);
    if (size <= budget) {
      return true;
    }
    for (let i = start; i < choices.length; i++) {
      const choice = choices[i];
      if (popcount(choice) * budget < size) {
        break;
      }
      if ((choice & todo) === choice && cover(todo ^ choice, budget - 1, i + 1)) {
        return true;
      }
    }
    return false;
  }
  return exceptions.has(required) || cover(required, 4, 0);
}

function controlMasks(catalogs, checkpoints) {
  const keys = Object.keys(checkpoints[30]);
  const bits = new Map(keys.map((key, i) => [key, 1 << i]));
  const mask = (group) =>
    group.selectors.reduce((m, s) => m | (bits.get(exactSelector(s)) ?? 0), 0);
  const quarantines = catalogs.containment_cohorts.cohorts.map(mask);
  const exceptions = catalogs.exception_bundles.bundles.map(mask);
  const wide = quarantines.filter((m) => popcount(m) >= 7);
  const short = new Set();
  // For 15 or 16 required selectors, two Qs are the only way to cover enough
  // reads with one E in three requests. Direct controls cover one read each.
  for (const [i, left] of wide.entries()) {
    for (const right of wide.slice(i + 1)) {
      if ((left & right) !== 0 || popcount(left | right) < 15) {
        continue;
      }
      for (const e of exceptions) {
        short.add((left | right) & ~e);
      }
    }
  }
  return { keys, bits, quarantines, short };
}

function hypotheticalPlan(catalogs, checkpoints, controls, oddMask, flip) {
  const evenMask = oddMask & ~controls.bits.get(flip);
  if (
    controls.quarantines.some((q) => popcount(q) === 6 && (q & evenMask) === 0) ||
    hasShortCover(oddMask, controls.quarantines, controls.short) ||
    hasShortCover(evenMask, controls.quarantines, controls.short)
  ) {
    return null;
  }
  const rows = (prefix, unsafe) =>
    Object.fromEntries(
      controls.keys.map((key) => {
        const status = unsafe & controls.bits.get(key) ? 'unsafe' : 'approved';
        return [key, { status: prefix?.[key].status === 'unresolved' ? 'unresolved' : status }];
      }),
    );
  const prior = [];
  for (const ordinal of [20, 24, 30]) {
    const command = chooseStagedQuarantine(catalogs, rows(checkpoints[ordinal], oddMask), prior);
    if (!command) {
      return null;
    }
    prior.push(command.args.cohort_id);
  }
  return {
    prior,
    small: chooseStagedException(catalogs, rows(null, oddMask), prior)?.args.exception_id,
    large: chooseStagedException(catalogs, rows(null, evenMask), prior)?.args.exception_id,
  };
}

// Every retained trio, including the real one, must support the same three
// distinct hypothetical pairs under the actual prefix and final choosers.
function alternativeWorlds(catalogs, checkpoints, sequences, flip) {
  const controls = controlMasks(catalogs, checkpoints);
  const verified = new Map();
  const plausible = [];
  for (const sequence of sequences) {
    const ids = sequence.groups.map((g) => g.id);
    const union = sequence.groups.flatMap((g) => g.keys);
    const supported = new Set();
    for (const pair of sequence.pairs) {
      const mask = union
        .filter((k) => !pair.keys.includes(k))
        .reduce((m, k) => m | controls.bits.get(k), 0);
      if (!verified.has(mask)) {
        verified.set(mask, hypotheticalPlan(catalogs, checkpoints, controls, mask, flip));
      }
      const result = verified.get(mask);
      if (
        result?.small === pair.small &&
        result.large === pair.large &&
        result.prior.every((id, i) => id === ids[i])
      ) {
        supported.add(pair.key);
      }
    }
    if (supported.size === 3) {
      plausible.push(sequence);
    }
  }
  return plausible;
}

function hasTimingMotifRivals(catalogs, checkpoints, flip) {
  const classify = (group) => {
    const all = group.selectors.map(exactSelector);
    return {
      keys: all.filter((k) => Object.hasOwn(checkpoints[30], k)),
      archive: all.filter((k) => !Object.hasOwn(checkpoints[30], k)),
    };
  };
  const six = catalogs.containment_cohorts.cohorts
    .map((group) => ({ id: group.cohort_id, ...classify(group) }))
    .filter((g) => g.keys.length === 6);
  const bundles = catalogs.exception_bundles.bundles.map((g) => ({
    id: g.exception_id,
    ...classify(g),
  }));
  const larger = bundles.filter((g) => g.keys.length === 3 && g.keys.includes(flip));
  const pairs = bundles
    .filter((g) => g.keys.length === 2 && !g.keys.includes(flip))
    .flatMap((small) =>
      larger
        .filter((large) => small.keys.every((k) => large.keys.includes(k)))
        .map((large) => ({
          small: small.id,
          large: large.id,
          keys: small.keys,
          key: JSON.stringify([...small.keys].sort()),
          archive: [...small.archive, ...large.archive],
        })),
    );
  const archive = catalogs.containment_cohorts.candidates
    .map(exactSelector)
    .filter((k) => !Object.hasOwn(checkpoints[30], k));
  if (hasConcentratedExceptions(pairs, archive, flip)) {
    return false;
  }
  const stages = [20, 24, 30].map((ordinal, stage) =>
    six.filter(
      (g) =>
        g.keys.filter((k) => checkpoints[ordinal][k].status === 'unresolved').length ===
          (stage === 2 ? 1 : 0) &&
        (stage !== 2 || g.keys.includes(flip)) &&
        (stage !== 1 || pairs.some((pair) => pair.keys.every((k) => g.keys.includes(k)))),
    ),
  );
  // The Cartesian-product check is independent of the producer's selected
  // path. Four choices at each stage yield 64 realisable paths with equal
  // continuation counts, even after either prior choice has been revealed.
  const possible = alternativeWorlds(catalogs, checkpoints, publicSequences(stages, pairs), flip);
  if (possible.length !== 64) {
    return false;
  }
  return stages.every((_, stage) => {
    const choices = new Map(
      possible.map(({ groups }) => [groups[stage].id, groups[stage].archive]),
    );
    const distinctFillers = new Set(
      [...choices.values()].map((keys) => JSON.stringify([...keys].sort())),
    );
    return choices.size === 4 && distinctFillers.size === 4;
  });
}

/** Producer-only gate; the chooser receives only catalog groups and visible statuses. */
export function hasUniqueStagedPlans(catalogs, checkpoints, evenUnsafeKeys, oddUnsafeKeys) {
  const visible = {
    containment_cohorts: catalogs.containment_cohorts,
    exception_bundles: catalogs.exception_bundles,
  };
  const prior = [];
  for (const ordinal of [20, 24, 30]) {
    const cmd = chooseStagedQuarantine(visible, checkpoints[ordinal], prior);
    if (!cmd || cmd.args.cohort_id !== catalogs.witnesses.even[prior.length].args.cohort_id) {
      return false;
    }
    prior.push(cmd.args.cohort_id);
  }
  const flip = [...oddUnsafeKeys].find((key) => !evenUnsafeKeys.has(key));
  if (!hasTimingMotifRivals(visible, checkpoints, flip)) {
    return false;
  }
  return [
    ['even', evenUnsafeKeys],
    ['odd', oddUnsafeKeys],
  ].every(([variant, unsafe]) => {
    const rows = Object.fromEntries(
      Object.keys(checkpoints[30]).map((key) => [
        key,
        { status: unsafe.has(key) ? 'unsafe' : 'approved' },
      ]),
    );
    const chosen = chooseStagedException(visible, rows, prior);
    return chosen?.args.exception_id === catalogs.witnesses[variant][3].args.exception_id;
  });
}

const Q_SIZE = 8;
const E_SIZE = 6;
const ACTION_BUDGET = 4;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactSelector(selector) {
  if (!record(selector) || Object.keys(selector).sort().join(',') !== 'id,kind') {
    throw new Error('v35 selector must have exact kind and ID fields');
  }
  return selectorKey(selector);
}

function hashOrder(items, salt, identity) {
  return items
    .map((item) => {
      const id = identity(item);
      return { item, id, rank: sha256Hex(salt + '|' + id) };
    })
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id))
    .map(({ item }) => item);
}

function canonicalMembership(members) {
  return JSON.stringify(members.map(exactSelector).sort());
}

function keysOf(value, label) {
  if (!(value instanceof Set) || [...value].some((key) => typeof key !== 'string')) {
    throw new Error(`v35 ${label} must be a selector-key Set`);
  }
  return value;
}

function validateBuilderInputs(candidates, options) {
  const { pairSeed, family, nonce } = options;
  if (!Number.isSafeInteger(pairSeed) || pairSeed % 2 !== 0) {
    throw new Error('v35 pairSeed must be an even safe integer');
  }
  if (typeof family !== 'string' || !family) {
    throw new Error('v35 family must be nonempty');
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error('v35 nonce must be a nonnegative safe integer');
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
    throw new Error('v35 currentKeys must select twelve current Jobs and sessions each');
  }
  if (
    even.size !== 15 ||
    odd.size !== 16 ||
    [...even].some((key) => !current.has(key) || !odd.has(key)) ||
    [...odd].some((key) => !current.has(key))
  ) {
    throw new Error('v35 paired unsafe sets must have a single 15-to-16 approval flip');
  }
  return { current, even, odd };
}

// A standalone run shares one private key across both paired members. A frozen
// multi-process run supplies its own key so different consoles recreate its case.
const processCatalogKey = randomBytes(32);

function privateLayoutSalt({
  catalogKey = process.env.F3_V35_CATALOG_KEY,
  pairSeed,
  family,
  nonce,
}) {
  if (
    catalogKey !== undefined &&
    (typeof catalogKey !== 'string' || !/^[a-f0-9]{64}$/iu.test(catalogKey))
  ) {
    throw new Error('v35 catalog key must encode 256 bits as 64 hex characters');
  }
  const key = catalogKey === undefined ? processCatalogKey : Buffer.from(catalogKey, 'hex');
  return createHmac('sha256', key)
    .update(JSON.stringify(['v35', 'private-layout', pairSeed, family, nonce]))
    .digest('hex');
}

function displayedGroupId(prefix, canonical) {
  return (
    prefix + '-' + sha256Hex('v35|presentation|' + prefix + '|group|' + canonical).slice(0, 20)
  );
}

function layoutRound(candidates, { round, retry, size, planted, salt, prefix, quarantineShape }) {
  const used = new Set(planted?.map(exactSelector) ?? []);
  if (used.size !== (planted?.length ?? 0) || (planted && planted.length !== size)) {
    throw new Error(`v35 ${prefix} planted group is malformed`);
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
  if (quarantineShape) {
    const current = remaining.filter((s) => quarantineShape.current.has(exactSelector(s)));
    const archive = remaining.filter((s) => !quarantineShape.current.has(exactSelector(s)));
    for (const count of planted ? [3, 3, 4, 4, 4] : [3, 3, 4, 4, 5, 5]) {
      const members = current.splice(0, count);
      if (!quarantineShape.allowed(members)) {
        return null;
      }
      roundGroups.push([...members, ...archive.splice(0, size - count)]);
    }
  } else {
    for (let offset = 0; offset < remaining.length; offset += size) {
      roundGroups.push(remaining.slice(offset, offset + size));
    }
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
    throw new Error(`v35 ${prefix} round does not partition the candidate index`);
  }
  return roundGroups.map((members) => {
    const canonical = canonicalMembership(members);
    return {
      canonical,
      id: displayedGroupId(prefix, canonical),
      selectors: hashOrder(
        members,
        `v35|presentation|${prefix}|members|${canonical}`,
        exactSelector,
      ),
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

function partitionRounds(
  candidates,
  { rounds, size, reserved, salt, idName, prefix, reservedPairMembers, quarantineShape },
) {
  const groups = [];
  const seen = { memberships: new Set(), ids: new Set() };
  const reservedSets = {
    memberships: new Set([...reserved.values()].map(canonicalMembership)),
    ids: new Set(),
  };
  if (reservedSets.memberships.size !== reserved.size) {
    throw new Error(`v35 ${prefix} planted groups have duplicate membership`);
  }
  reservedSets.ids = new Set(
    [...reservedSets.memberships].map((canonical) => displayedGroupId(prefix, canonical)),
  );
  if (reservedSets.ids.size !== reserved.size) {
    throw new Error(`v35 ${prefix} planted groups have duplicate IDs`);
  }
  for (let round = 0; round < rounds; round += 1) {
    const planted = reserved.get(round);
    const plantedCanonical = planted ? canonicalMembership(planted) : null;
    let accepted = null;
    for (let retry = 0; retry < (quarantineShape ? 512 : 64) && accepted === null; retry += 1) {
      const candidateGroups = layoutRound(candidates, {
        round,
        retry,
        size,
        planted,
        salt,
        prefix,
        quarantineShape,
      });
      if (!candidateGroups) {
        continue;
      }
      // Only the six paired E bundles may restore two of the common Q2
      // members. Apply the same rule to each of the three possible pairs.
      const duplicatesPair =
        reservedPairMembers &&
        candidateGroups.some(
          (group) =>
            group.canonical !== plantedCanonical &&
            group.selectors.filter((s) => reservedPairMembers.has(exactSelector(s))).length >= 2,
        );
      if (
        !duplicatesPair &&
        !hasGroupCollision(candidateGroups, plantedCanonical, seen, reservedSets)
      ) {
        accepted = candidateGroups;
      }
    }
    if (accepted === null) {
      throw new Error(`v35 ${prefix} cannot construct a unique partition round`);
    }
    for (const group of accepted) {
      seen.memberships.add(group.canonical);
      seen.ids.add(group.id);
      groups.push({ [idName]: group.id, selectors: group.selectors });
    }
  }
  return hashOrder(groups, `v35|presentation|${prefix}|catalog-order`, (group) => group[idName]);
}

function quarantineWithArchive(members, pool, salt) {
  const order = hashOrder(
    pool,
    salt + '|quarantine-fillers|' + canonicalMembership(members),
    exactSelector,
  );
  return [...members, ...order.slice(0, 2)];
}

// Paired E variants share their two current members. Their archive draw is
// independent of all Q draws, so archive overlap carries no authorization rule.
function exceptionPairWithArchive(pair, flip, pool, salt) {
  const order = hashOrder(
    pool,
    salt + '|exception-fillers|' + canonicalMembership(pair),
    exactSelector,
  );
  return [
    [...pair, flip, ...order.slice(0, 3)],
    [...pair, ...order.slice(3, 7)],
  ];
}

// The four branches differ only in which of four variable selectors is
// omitted. Every stage uses a disjoint seven-selector pool. The fourth arm
// omits the spare approved selector and supplies the private witness.
function quarantineArms(core, variable, archive, salt) {
  return variable.map((omitted) =>
    quarantineWithArchive(
      [...core, ...variable.filter((member) => member !== omitted)],
      archive,
      salt,
    ),
  );
}

/** Build paired catalogs from visible selector and authorization facts. Witnesses stay private. */
export function buildCoupledCatalog(index, options = {}) {
  const candidates = extractCohortCandidates(index);
  const { current, even, odd } = validateBuilderInputs(candidates, options);
  const salt = privateLayoutSalt(options);
  const { checkpoints } = options;
  const flipKey = [...odd].find((key) => !even.has(key));
  for (const ordinal of [20, 24, 30]) {
    const rows = checkpoints?.[ordinal];
    if (
      !record(rows) ||
      Object.keys(rows).length !== current.size ||
      [...current].some((key) => {
        const status = rows[key]?.status;
        return (
          !['approved', 'unsafe', 'unresolved'].includes(status) ||
          (status === 'approved' && odd.has(key)) ||
          (status === 'unsafe' && !even.has(key))
        );
      })
    ) {
      throw new Error('v35 checkpoint rows differ from the paired authorization sets');
    }
  }
  const ordered = hashOrder(candidates, salt + '|witness', exactSelector);
  const taken = new Set();
  function take(ordinal, status, count) {
    const batch = ordered
      .filter((s) => !taken.has(s) && checkpoints[ordinal][exactSelector(s)]?.status === status)
      .slice(0, count);
    if (batch.length !== count) {
      throw new Error('v35 checkpoint lacks required selectors');
    }
    for (const selector of batch) {
      taken.add(selector);
    }
    return batch;
  }
  const first = take(20, 'unsafe', 6);
  const [firstSpare] = take(20, 'approved', 1);
  const second = take(24, 'unsafe', 4);
  const safe = take(24, 'approved', 2);
  const [secondSpare] = take(24, 'approved', 1);
  const third = take(30, 'unsafe', 5);
  const [thirdSpare] = take(30, 'approved', 1);
  const flip = candidates.find((s) => exactSelector(s) === flipKey);
  if (flip.kind !== 'job' || checkpoints[30][flipKey].status !== 'unresolved') {
    throw new Error('v35 flipped renewal Job must remain unresolved at checkpoint 30');
  }
  const archive = candidates.filter((selector) => !current.has(exactSelector(selector)));
  const firstArms = quarantineArms(
    first.slice(0, 3),
    [...first.slice(3), firstSpare],
    archive,
    salt,
  );
  const secondCore = [...safe, second[0]];
  const secondArms = quarantineArms(secondCore, [...second.slice(1), secondSpare], archive, salt);
  const thirdArms = quarantineArms(
    [flip, ...third.slice(0, 2)],
    [...third.slice(2), thirdSpare],
    archive,
    salt,
  );
  const plantedQ = [firstArms[3], secondArms[3], thirdArms[3]];
  const reservedQ = hashOrder(
    [...firstArms, ...secondArms, ...thirdArms],
    salt + '|q-reservation',
    canonicalMembership,
  );
  const pairs = [
    [secondCore[0], secondCore[1]],
    [secondCore[0], secondCore[2]],
    [secondCore[1], secondCore[2]],
  ].map((pair) => exceptionPairWithArchive(pair, flip, archive, salt));
  const [plantedEvenE, plantedOddE] = pairs[0];
  const reservedE = hashOrder(pairs.flat(), salt + '|e-reservation', canonicalMembership);
  // In every hypothetical world, Q2's seven selectors contain four unsafe
  // reads. Any usable ordinary Q covering one of these reads may cover only
  // one, and at most three current reads overall. Four exception-free actions
  // can therefore block at most twelve reads, below the required 15 or 16.
  const pool = new Set(reservedQ.flatMap((group) => group.slice(0, 6)));
  const variable = new Set([...second.slice(1), secondSpare]);
  const allowed = (members) => {
    const coreHits = members.filter((s) => secondCore.includes(s)).length;
    const variableHits = members.filter((s) => variable.has(s)).length;
    return (
      coreHits + variableHits === 0 ||
      coreHits >= 2 ||
      variableHits === 4 ||
      members.some((s) => !pool.has(s)) ||
      (coreHits + variableHits === 1 && members.length <= 3)
    );
  };
  const cohorts = partitionRounds(candidates, {
    rounds: 32,
    size: Q_SIZE,
    quarantineShape: { current, allowed },
    reserved: new Map(reservedQ.map((members, round) => [round, members])),
    salt,
    idName: 'cohort_id',
    prefix: 'cohort',
  });
  const bundles = partitionRounds(candidates, {
    rounds: 24,
    size: E_SIZE,
    reserved: new Map(reservedE.map((members, round) => [round, members])),
    salt,
    reservedPairMembers: new Set(secondCore.map(exactSelector)),
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
      throw new Error('v35 planted witness is absent from its catalog');
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
    throw new Error(`v35 ${prefix} catalog is missing candidates or groups`);
  }
  if (catalog.candidates.length !== 48 || catalog[groupsKey].length !== 192) {
    throw new Error(`v35 ${prefix} catalog requires 48 candidates and 192 groups`);
  }
  const candidates = new Set();
  let jobs = 0;
  let sessions = 0;
  for (const selector of catalog.candidates) {
    const key = exactSelector(selector);
    if (candidates.has(key)) {
      throw new Error(`v35 ${prefix} has duplicate candidate ${key}`);
    }
    candidates.add(key);
    jobs += Number(selector.kind === 'job');
    sessions += Number(selector.kind === 'session');
  }
  if (jobs !== 24 || sessions !== 24) {
    throw new Error(`v35 ${prefix} requires 24 Job and 24 session candidates`);
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
      throw new Error(`v35 ${prefix} group needs an opaque ID and ${size} selectors`);
    }
    if (ids.has(group[idKey])) {
      throw new Error(`v35 ${prefix} has duplicate group ID ${group[idKey]}`);
    }
    ids.add(group[idKey]);
    const members = new Set();
    for (const selector of group.selectors) {
      const key = exactSelector(selector);
      if (members.has(key)) {
        throw new Error(`v35 ${prefix} group has duplicate selector ${key}`);
      }
      if (!candidates.has(key)) {
        throw new Error(`v35 ${prefix} group has unknown selector ${key}`);
      }
      members.add(key);
      counts.set(key, counts.get(key) + 1);
    }
    const canonical = canonicalMembership(group.selectors);
    if (memberships.has(canonical)) {
      throw new Error(`v35 ${prefix} catalog has duplicate group membership`);
    }
    memberships.add(canonical);
  }
  if ([...counts.values()].some((count) => count !== degree)) {
    throw new Error(`v35 ${prefix} catalog does not have uniform selector degree ${degree}`);
  }
  return candidates;
}

/** Validate the visible catalogs; producer-only witnesses are optional and ignored. */
export function validateCoupledCatalog(catalogs) {
  if (!record(catalogs)) {
    throw new Error('v35 coupled catalogs are missing');
  }
  const q = validateSide(catalogs.containment_cohorts, {
    groupsKey: 'cohorts',
    idKey: 'cohort_id',
    prefix: 'cohort',
    size: Q_SIZE,
    degree: 32,
  });
  const e = validateSide(catalogs.exception_bundles, {
    groupsKey: 'bundles',
    idKey: 'exception_id',
    prefix: 'exception',
    size: E_SIZE,
    degree: 24,
  });
  if (q.size !== e.size || [...q].some((key) => !e.has(key))) {
    throw new Error('v35 paired catalogs have different candidate selectors');
  }
  return q;
}

function actionKey(action) {
  if (
    !record(action) ||
    Object.keys(action).sort().join(',') !== 'args,tool' ||
    !record(action.args)
  ) {
    throw new Error('v35 atomic action must have exact tool and args');
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
  throw new Error('v35 atomic action must be an exact Job pause or session denial');
}

function plannerInputs(catalogs, currentActionsMap, requiredActions, maxActions) {
  const candidates = validateCoupledCatalog(catalogs);
  if (!(currentActionsMap instanceof Map) || !Array.isArray(requiredActions)) {
    throw new Error('v35 planner requires current action Map and required action array');
  }
  const currentSelectors = [...currentActionsMap.keys()];
  if (
    currentActionsMap.size !== 24 ||
    currentSelectors.filter((key) => typeof key === 'string' && key.startsWith('job:')).length !==
      12 ||
    currentSelectors.filter((key) => typeof key === 'string' && key.startsWith('session:'))
      .length !== 12
  ) {
    throw new Error('v35 current action map needs twelve current Jobs and twelve current sessions');
  }
  if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
    throw new Error('v35 maxActions must be a nonnegative safe integer');
  }
  const byAction = new Map();
  for (const [selector, action] of currentActionsMap) {
    if (!candidates.has(selector)) {
      throw new Error(`v35 current action has unknown selector ${selector}`);
    }
    const key = actionKey(action);
    if (
      (selector.startsWith('job:') && key !== `pause-job:${selector.slice(4)}`) ||
      (selector.startsWith('session:') && !key.startsWith('deny-role-session:')) ||
      byAction.has(key)
    ) {
      throw new Error(`v35 current action has ambiguous or mismatched selector ${selector}`);
    }
    byAction.set(key, selector);
  }
  const requiredKeys = [...new Set(requiredActions.map(actionKey))].sort();
  if (requiredKeys.length > 30) {
    throw new Error('v35 planner has too many required controls for its bitmask');
  }
  for (const key of requiredKeys) {
    if (!byAction.has(key)) {
      throw new Error(`v35 required action is not current: ${key}`);
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
  const currentIndex = new Map([...currentActionsMap.keys()].map((key, index) => [key, index]));
  const choices = [];
  for (const cohort of catalogs.containment_cohorts.cohorts) {
    let mask = 0;
    let occupancy = 0;
    let safe = true;
    for (const selector of cohort.selectors) {
      const key = exactSelector(selector);
      const currentBit = currentIndex.get(key);
      if (currentBit === undefined) {
        continue;
      }
      occupancy |= 1 << currentBit;
      if (exempt.has(key)) {
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
        occupancy,
      });
    }
  }
  for (const [index, selector] of requiredSelectors.entries()) {
    choices.push({ command: currentActionsMap.get(selector), mask: 1 << index, occupancy: 0 });
  }
  choices.sort((left, right) => commandKey(left.command).localeCompare(commandKey(right.command)));
  return choices;
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
  const best = (mask, occupied, remaining) => {
    if (mask === fullMask) {
      return [];
    }
    if (remaining === 0) {
      return null;
    }
    const memoKey = `${mask}|${occupied}|${remaining}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }
    const uncovered = fullMask & ~mask;
    const maximumGain = Math.max(
      0,
      ...choices
        .filter((choice) => (choice.occupancy & occupied) === 0)
        .map((choice) => popcount(choice.mask & uncovered)),
    );
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
      if (choice.occupancy & occupied) {
        continue;
      }
      const tail = best(mask | choice.mask, occupied | choice.occupancy, remaining - 1);
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
  const indices = best(0, 0, maxActions);
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
