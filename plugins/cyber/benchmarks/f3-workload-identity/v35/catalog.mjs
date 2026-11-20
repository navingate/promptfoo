import { createHmac, randomBytes } from 'node:crypto';

import { sha256Hex } from '../shared/estate.mjs';
import { extractCohortCandidates, selectorKey } from '../v31/cohorts.mjs';
import { chooseStagedException, chooseStagedQuarantine } from './staged_plan.mjs';

// Count complete sequences using only the current index, public E pair shapes,
// final query ID, and which evidence can be resolved at each cutoff. No
// authorization value is used to rank any sequence.
function hasTimingMotifRivals(catalogs, checkpoints, witness, flip) {
  const classify = (group) => {
    const all = group.selectors.map(exactSelector);
    return {
      keys: all.filter((key) => Object.hasOwn(checkpoints[30], key)),
      archive: all.filter((key) => !Object.hasOwn(checkpoints[30], key)),
    };
  };
  const six = catalogs.containment_cohorts.cohorts
    .map((group) => ({ id: group.cohort_id, ...classify(group) }))
    .filter((group) => group.keys.length === 6);
  const bundles = catalogs.exception_bundles.bundles.map(classify);
  const larger = bundles.filter((group) => group.keys.length === 3 && group.keys.includes(flip));
  const pairs = bundles
    .filter((group) => group.keys.length === 2)
    .flatMap((small) =>
      larger
        .filter((large) => small.keys.every((key) => large.keys.includes(key)))
        .map((large) => ({
          keys: small.keys,
          archive: [...small.archive, ...large.archive],
        })),
    );
  const stages = [20, 24, 30].map((ordinal, stage) =>
    six.filter(
      ({ keys }) =>
        keys.filter((key) => checkpoints[ordinal][key].status === 'unresolved').length ===
          (stage === 2 ? 1 : 0) &&
        (stage !== 2 || keys.includes(flip)) &&
        (stage !== 1 || pairs.some((pair) => pair.keys.every((key) => keys.includes(key)))),
    ),
  );
  const counts = [new Map(), new Map(), new Map()];
  const archiveCounts = [new Map(), new Map(), new Map()];
  const disjoint = (a, b) => a.keys.every((key) => !b.keys.includes(key));
  for (const first of stages[0]) {
    for (const second of stages[1]) {
      if (!disjoint(first, second)) {
        continue;
      }
      const candidatePairs = pairs.filter((pair) =>
        pair.keys.every((key) => second.keys.includes(key)),
      );
      for (const third of stages[2]) {
        if (!disjoint(first, third) || !disjoint(second, third)) {
          continue;
        }
        const fillers = [...first.archive, ...second.archive, ...third.archive];
        const matchesArchive = candidatePairs.some(
          (pair) => new Set([...fillers, ...pair.archive]).size === 13,
        );
        for (const [stage, group] of [first, second, third].entries()) {
          counts[stage].set(group.id, 1 + (counts[stage].get(group.id) ?? 0));
          if (matchesArchive) {
            archiveCounts[stage].set(group.id, 1 + (archiveCounts[stage].get(group.id) ?? 0));
          }
          if (group.id !== witness[stage]) {
            break;
          }
        }
      }
    }
  }
  return [counts, archiveCounts].every((ranks) =>
    ranks.every((rank, stage) => {
      const target = rank.get(witness[stage]);
      const rivals = [...rank].filter(([id]) => id !== witness[stage]).map(([, count]) => count);
      return (
        rivals.length >= 3 && rivals.some((n) => n >= target) && rivals.some((n) => n <= target)
      );
    }),
  );
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
  if (!hasTimingMotifRivals(visible, checkpoints, prior, flip)) {
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

function layoutRound(candidates, { round, retry, size, planted, salt, prefix }) {
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

function partitionRounds(candidates, { rounds, size, reserved, salt, idName, prefix }) {
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

// Each rival triple has the same public timing pattern as the witness, including
// the final Job. Third-stage rivals also remain available after the real Q1/Q2.
function decoyQuarantines(candidates, checkpoints, planted, archivePools, flip, salt) {
  const reserved = [...planted];
  const memberKeys = (group) =>
    group
      .map(exactSelector)
      .filter((key) => checkpoints[30][key])
      .sort()
      .join('|');
  const used = new Set(planted.map(memberKeys));
  for (let triple = 0; triple < 3; triple++) {
    let accepted = false;
    for (let retry = 0; retry < 256 && !accepted; retry++) {
      const decoySalt = salt + '|rival|' + triple + '|' + retry;
      const ordered = hashOrder(candidates, decoySalt, exactSelector);
      const unavailable = new Set();
      const groups = [];
      for (const [stage, ordinal] of [20, 24, 30].entries()) {
        const known = ordered.filter((s) => {
          const row = checkpoints[ordinal][exactSelector(s)];
          return (
            row &&
            row.status !== 'unresolved' &&
            !unavailable.has(s) &&
            (stage !== 2 || (!planted[0].includes(s) && !planted[1].includes(s)))
          );
        });
        const members = stage === 2 ? [...known.slice(0, 5), flip] : known.slice(0, 6);
        const unsafe = members.filter(
          (s) => checkpoints[ordinal][exactSelector(s)].status === 'unsafe',
        ).length;
        if (
          members.length !== 6 ||
          unsafe === 0 ||
          unsafe === [6, 4, 5][stage] ||
          used.has(memberKeys(members))
        ) {
          break;
        }
        groups.push(quarantineWithArchive(members, archivePools[stage], salt));
        for (const s of members) {
          unavailable.add(s);
        }
      }
      if (groups.length === 3) {
        reserved.push(...groups);
        for (const g of groups) {
          used.add(memberKeys(g));
        }
        accepted = true;
      }
    }
    if (!accepted) {
      throw new Error('v35 cannot construct a unique partition round with staged rivals');
    }
  }
  return reserved;
}

// Keep several authorization-disqualified seconds available after the real Q1,
// even if the deadline leaves only seven eligible selectors outside it.
function addSecondStageRivals(reserved, candidates, checkpoints, archive, salt) {
  const first = reserved[0];
  const second = reserved[1].slice(0, 6);
  const status = (selector) => checkpoints[24][exactSelector(selector)]?.status;
  const extra = candidates.filter(
    (selector) =>
      ['approved', 'unsafe'].includes(status(selector)) &&
      !first.includes(selector) &&
      !second.includes(selector),
  );
  const existing = new Set(
    reserved.map((group) => group.slice(0, 6).map(exactSelector).sort().join('|')),
  );
  const choices = [];
  for (const outsider of extra) {
    for (const omit of second) {
      if (status(omit) === status(outsider)) {
        continue;
      }
      const members = [...second.filter((key) => key !== omit), outsider];
      const signature = members.map(exactSelector).sort().join('|');
      if (!existing.has(signature)) {
        choices.push({ members, signature });
      }
    }
  }
  const ranked = hashOrder(choices, salt + '|seconds', (choice) => choice.signature);
  for (const { members } of ranked.slice(0, 4)) {
    reserved.push(quarantineWithArchive(members, archive, salt));
  }
}

// Additional second-stage choices remain available after rival first Qs.
// Otherwise the correct first Q can have a uniquely high continuation count.
function addRivalContinuations(reserved, archive, salt) {
  const seen = new Set(
    reserved.map((group) => group.slice(0, 6).map(exactSelector).sort().join('|')),
  );
  const thirds = [2, 5, 8, 11].map((i) => reserved[i].slice(0, 6));
  const seconds = [reserved[1], reserved[4], reserved[7], reserved[10], ...reserved.slice(12)];
  const disjoint = (a, b) => a.every((s) => !b.includes(s));
  const firsts = [3, 6, 9]
    .map((i) => reserved[i].slice(0, 6))
    .sort(
      (a, b) =>
        thirds.filter((g) => disjoint(b, g)).length - thirds.filter((g) => disjoint(a, g)).length,
    );
  // Favor one structurally compatible rival in addition to the witness. Keep
  // other rivals at their natural ranks so neither tail signals authorization.
  const first = firsts[0];
  const borrow = reserved[0].slice(0, 6).filter((s) => !first.includes(s));
  const choices = new Map();
  for (const secondGroup of seconds) {
    const second = secondGroup.slice(0, 6);
    for (const selector of borrow.filter((s) => !second.includes(s))) {
      for (const omit of second) {
        const members = [...second.filter((s) => s !== omit), selector];
        if (!disjoint(first, members)) {
          continue;
        }
        const signature = members.map(exactSelector).sort().join('|');
        if (seen.has(signature)) {
          continue;
        }
        const continuations = thirds.filter(
          (g) => disjoint(first, g) && disjoint(members, g),
        ).length;
        if (continuations) {
          choices.set(signature, { members, signature, continuations });
        }
      }
    }
  }
  const ordered = hashOrder(
    [...choices.values()],
    salt + '|continuations',
    (choice) => choice.signature,
  ).sort((a, b) => b.continuations - a.continuations);
  // Allow untouched partition rounds to contribute ordinary random groups too.
  for (const { members } of ordered.slice(0, 12)) {
    reserved.push(quarantineWithArchive(members, archive, salt));
  }
}

// Include the public two-to-three member E motif in every staged rival, with
// the same unresolved Job added to the larger E as in the winning pair.
function decoyExceptions(reservedQ, archive, flip, plantedEven, plantedOdd, salt) {
  const reserved = [plantedEven, plantedOdd];
  const pairKey = (members) => members.slice(0, 2).map(exactSelector).sort().join('|');
  const seen = new Set([pairKey(plantedOdd)]);
  for (const start of [0, 3, 6, 9]) {
    for (let motif = start === 0 ? 1 : 0; motif < 3; motif++) {
      let accepted = false;
      for (let retry = 0; retry < 64 && !accepted; retry++) {
        const decoySalt = salt + '|exception-rival|' + start + '|' + motif + '|' + retry;
        const pair = hashOrder(reservedQ[start + 1].slice(0, 6), decoySalt, exactSelector).slice(
          0,
          2,
        );
        const signature = pairKey(pair);
        if (seen.has(signature)) {
          continue;
        }
        reserved.push(...exceptionPairWithArchive(pair, flip, archive, salt));
        seen.add(signature);
        accepted = true;
      }
      if (!accepted) {
        throw new Error('v35 cannot construct a unique partition round with exception rivals');
      }
    }
  }
  return reserved;
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
  const second = take(24, 'unsafe', 4);
  const safe = take(24, 'approved', 2);
  const third = take(30, 'unsafe', 5);
  const flip = candidates.find((s) => exactSelector(s) === flipKey);
  if (flip.kind !== 'job' || checkpoints[30][flipKey].status !== 'unresolved') {
    throw new Error('v35 flipped renewal Job must remain unresolved at checkpoint 30');
  }
  const archive = hashOrder(
    candidates.filter((selector) => !current.has(exactSelector(selector))),
    salt + '|archive-order',
    exactSelector,
  );
  // Give each Q slot its own archive pool and draw both paired E groups from
  // the remainder. The thirteen distinct fillers therefore occur throughout
  // the competing plans, including alternatives after the real first two Qs.
  const qPools = [archive.slice(0, 5), archive.slice(5, 10), archive.slice(10, 15)];
  const ePool = archive.slice(15);
  const plantedQ = [first, [...second, ...safe], [...third, flip]].map((members, stage) =>
    quarantineWithArchive(members, qPools[stage], salt),
  );
  const reservedQ = decoyQuarantines(candidates, checkpoints, plantedQ, qPools, flip, salt);
  const [plantedEvenE, plantedOddE] = exceptionPairWithArchive(safe, flip, ePool, salt);
  const reservedE = decoyExceptions(reservedQ, ePool, flip, plantedEvenE, plantedOddE, salt);
  addSecondStageRivals(reservedQ, candidates, checkpoints, qPools[1], salt);
  addRivalContinuations(reservedQ, qPools[1], salt);
  const cohorts = partitionRounds(candidates, {
    rounds: 32,
    size: Q_SIZE,
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
