import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES, sha256Hex } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import {
  buildCoupledCatalog,
  hasUniqueStagedPlans,
  solveMixedCover,
  solveNoExceptionCover,
  validateCoupledCatalog,
} from './catalog.mjs';
import { buildPairedSchedule } from './schedule.mjs';

const key = ({ kind, id }) => `${kind}:${id}`;

const cases = new Map();
const pairedCheckpoints = new WeakMap();

function caseData(seed, family) {
  const cacheKey = [seed, family].join('|');
  if (cases.has(cacheKey)) {
    return cases.get(cacheKey);
  }
  const episode = buildV32Episode({ seed, family });
  const { visible } = episode;
  const current = new Map([
    ...visible.job_queue.map(({ job_uid }) => [
      `job:${job_uid}`,
      { tool: 'pause-job', args: { job_uid } },
    ]),
    ...visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      `session:${access_key_ref}`,
      { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    ]),
  ]);
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const byAction = new Map(
    [...current].map(([selector, action]) => [JSON.stringify(action), selector]),
  );
  const unsafe = new Set(required.map((action) => byAction.get(JSON.stringify(action))));
  assert.equal(unsafe.has(undefined), false);
  const data = { episode, index: listWorkloads(visible), current, required, unsafe };
  cases.set(cacheKey, data);
  return data;
}

function pair(family = FAMILIES[0]) {
  return [caseData(100000, family), caseData(100001, family)];
}

function options(even, odd, nonce = 0, family = FAMILIES[0]) {
  if (!pairedCheckpoints.has(even)) {
    pairedCheckpoints.set(
      even,
      buildPairedSchedule(even.episode.visible, odd.episode.visible).checkpoints,
    );
  }
  return {
    checkpoints: pairedCheckpoints.get(even),
    pairSeed: 100000,
    family,
    nonce,
    currentKeys: new Set(even.current.keys()),
    evenUnsafeKeys: even.unsafe,
    oddUnsafeKeys: odd.unsafe,
  };
}

function blockedFrom(commands, catalogs, current) {
  const q = new Set();
  const e = new Set();
  const p = new Set();
  for (const command of commands) {
    if (command.tool === 'quarantine-cohort') {
      for (const member of catalogs.containment_cohorts.cohorts.find(
        (group) => group.cohort_id === command.args.cohort_id,
      ).selectors) {
        q.add(key(member));
      }
    } else if (command.tool === 'except-cohort') {
      for (const member of catalogs.exception_bundles.bundles.find(
        (group) => group.exception_id === command.args.exception_id,
      ).selectors) {
        e.add(key(member));
      }
    } else {
      const selector = [...current].find(
        ([, action]) => JSON.stringify(action) === JSON.stringify(command),
      );
      assert.ok(selector, 'direct control is current');
      p.add(selector[0]);
    }
  }
  return new Set(
    [...current.keys()].filter(
      (selector) => p.has(selector) || (q.has(selector) && !e.has(selector)),
    ),
  );
}

function currentOccupancy(commands, catalogs, current) {
  return commands
    .filter((command) => command.tool === 'quarantine-cohort')
    .flatMap((command) =>
      catalogs.containment_cohorts.cohorts
        .find((group) => group.cohort_id === command.args.cohort_id)
        .selectors.map(key)
        .filter((selector) => current.has(selector)),
    );
}

function exactNativePlan(commands, catalogs, current, required) {
  const occupancy = currentOccupancy(commands, catalogs, current);
  if (new Set(occupancy).size !== occupancy.length) {
    return false;
  }
  const blocked = blockedFrom(commands, catalogs, current);
  return (
    commands.filter((command) => command.tool === 'except-cohort').length <= 1 &&
    commands.filter((command) => command.tool === 'quarantine-cohort').length ===
      new Set(
        commands
          .filter((command) => command.tool === 'quarantine-cohort')
          .map((command) => command.args.cohort_id),
      ).size &&
    blocked.size === required.size &&
    [...blocked].every((selector) => required.has(selector))
  );
}

// Independent bounded enumeration: enumerate E, Q, and direct commands without planner masks or memoization.
function exhaustiveMinimumLength(catalogs, current, required, limit = 3) {
  const direct = [...required].map((selector) => current.get(selector));
  const quarantines = catalogs.containment_cohorts.cohorts.map((group) => ({
    tool: 'quarantine-cohort',
    args: { cohort_id: group.cohort_id },
  }));
  const exceptions = [
    null,
    ...catalogs.exception_bundles.bundles.map((group) => ({
      tool: 'except-cohort',
      args: { exception_id: group.exception_id },
    })),
  ];
  for (let length = 0; length <= limit; length += 1) {
    for (const exception of exceptions) {
      const prefix = exception ? [exception] : [];
      const slots = length - prefix.length;
      if (slots < 0) {
        continue;
      }
      const exempt = new Set(
        exception
          ? catalogs.exception_bundles.bundles
              .find((group) => group.exception_id === exception.args.exception_id)
              .selectors.map(key)
          : [],
      );
      const actions = [
        ...quarantines.filter((command) => {
          const members = catalogs.containment_cohorts.cohorts
            .find((group) => group.cohort_id === command.args.cohort_id)
            .selectors.map(key);
          return members.every(
            (selector) => !current.has(selector) || exempt.has(selector) || required.has(selector),
          );
        }),
        ...direct,
      ];
      const visit = (start, chosen) => {
        if (chosen.length === slots) {
          return exactNativePlan([...prefix, ...chosen], catalogs, current, required);
        }
        for (let index = start; index <= actions.length - (slots - chosen.length); index += 1) {
          if (visit(index + 1, [...chosen, actions[index]])) {
            return true;
          }
        }
        return false;
      };
      if (visit(0, [])) {
        return length;
      }
    }
  }
  return null;
}

function hasIndependentThreeRequestExceptionShortcut(catalogs, current, required) {
  const quarantines = catalogs.containment_cohorts.cohorts;
  for (const bundle of catalogs.exception_bundles.bundles) {
    const exception = { tool: 'except-cohort', args: { exception_id: bundle.exception_id } };
    const exempt = new Set(bundle.selectors.map(key));
    const needsDirect = [...required].some((selector) => exempt.has(selector));
    if (needsDirect && required.size > 9) {
      continue;
    }
    const eligible = quarantines.filter((group) =>
      group.selectors.every((member) => {
        const selector = key(member);
        return !current.has(selector) || exempt.has(selector) || required.has(selector);
      }),
    );
    for (let first = 0; first < eligible.length; first += 1) {
      const q1 = {
        tool: 'quarantine-cohort',
        args: { cohort_id: eligible[first].cohort_id },
      };
      if (!needsDirect) {
        for (let second = first + 1; second < eligible.length; second += 1) {
          const q2 = {
            tool: 'quarantine-cohort',
            args: { cohort_id: eligible[second].cohort_id },
          };
          if (exactNativePlan([q1, q2, exception], catalogs, current, required)) {
            return true;
          }
        }
      }
      if (required.size <= 9) {
        for (const selector of required) {
          if (
            exactNativePlan([q1, current.get(selector), exception], catalogs, current, required)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

test('balanced pair-stable catalogs have opaque IDs and no visible witness', () => {
  const [even, odd] = pair();
  const args = options(even, odd, 3);
  const first = buildCoupledCatalog(even.index, args);
  const again = buildCoupledCatalog(odd.index, args);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, buildCoupledCatalog(even.index, { ...args, nonce: 4 }));
  assert.deepEqual(Object.keys(first).sort(), [
    'containment_cohorts',
    'exception_bundles',
    'witnesses',
  ]);
  assert.equal(
    /witness|unsafe|approved|current/iu.test(
      JSON.stringify({
        containment_cohorts: first.containment_cohorts,
        exception_bundles: first.exception_bundles,
      }),
    ),
    false,
  );
  assert.doesNotThrow(() => validateCoupledCatalog(first));
  for (const [catalog, groups, id, size, degree, pattern] of [
    [first.containment_cohorts, 'cohorts', 'cohort_id', 8, 32, /^cohort-[a-f0-9]{20}$/u],
    [first.exception_bundles, 'bundles', 'exception_id', 6, 24, /^exception-[a-f0-9]{20}$/u],
  ]) {
    assert.equal(catalog.candidates.length, 48);
    assert.equal(catalog[groups].length, 192);
    const counts = new Map(catalog.candidates.map((selector) => [key(selector), 0]));
    for (const group of catalog[groups]) {
      assert.match(group[id], pattern);
      assert.equal(group.selectors.length, size);
      assert.equal(new Set(group.selectors.map(key)).size, size);
      for (const selector of group.selectors) {
        counts.set(key(selector), counts.get(key(selector)) + 1);
      }
    }
    assert.deepEqual(new Set(counts.values()), new Set([degree]));
  }
});

test('visible group IDs and member order depend on membership rather than round coordinates', () => {
  const [even, odd] = pair();
  const nonce = 3;
  const catalog = buildCoupledCatalog(even.index, options(even, odd, nonce));
  const unsafeDigest = sha256Hex(JSON.stringify([...odd.unsafe].sort()));
  const salt = `v35|coupled|100000|${FAMILIES[0]}|${nonce}|${unsafeDigest}`;
  for (const [groups, prefix, idName, rounds, perRound] of [
    [catalog.containment_cohorts.cohorts, 'cohort', 'cohort_id', 32, 6],
    [catalog.exception_bundles.bundles, 'exception', 'exception_id', 24, 8],
  ]) {
    const coordinateIds = new Set(
      Array.from(
        { length: rounds * perRound },
        (_, index) =>
          `${prefix}-${sha256Hex(`${salt}|${prefix}|id|${Math.floor(index / perRound)}|${index % perRound}`).slice(0, 20)}`,
      ),
    );
    for (const group of groups) {
      const canonical = JSON.stringify(group.selectors.map(key).sort());
      assert.equal(coordinateIds.has(group[idName]), false);
      assert.equal(
        group[idName],
        `${prefix}-${sha256Hex(`${salt}|${prefix}|group|${canonical}`).slice(0, 20)}`,
      );
      const expectedOrder = [...group.selectors].sort((left, right) =>
        sha256Hex(`${salt}|${prefix}|members|${canonical}|${key(left)}`).localeCompare(
          sha256Hex(`${salt}|${prefix}|members|${canonical}|${key(right)}`),
        ),
      );
      assert.deepEqual(group.selectors, expectedOrder);
    }
  }
});

test('paired witness uses cumulative evidence at each board slot', () => {
  const [even, odd] = pair();
  const args = options(even, odd);
  const catalogs = buildCoupledCatalog(even.index, args);
  assert.deepEqual(catalogs.witnesses.even.slice(0, 3), catalogs.witnesses.odd.slice(0, 3));
  const seen = new Set();
  for (const [stage, ordinal] of [20, 24, 30].entries()) {
    const command = catalogs.witnesses.even[stage];
    const members = currentOccupancy([command], catalogs, even.current);
    assert.equal(members.length, 6);
    for (const member of members) {
      assert.equal(seen.has(member), false);
      seen.add(member);
    }
    const statuses = members.map((key) => args.checkpoints[ordinal][key].status).sort();
    assert.deepEqual(
      statuses,
      [
        Array(6).fill('unsafe'),
        ['approved', 'approved', ...Array(4).fill('unsafe')],
        ['unresolved', ...Array(5).fill('unsafe')],
      ][stage].sort(),
      'ordinal ' + ordinal,
    );
    if (ordinal === 30) {
      const flipped = members.find((key) => args.checkpoints[ordinal][key].status === 'unresolved');
      assert.ok(flipped.startsWith('job:') && odd.unsafe.has(flipped) && !even.unsafe.has(flipped));
    }
  }
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, checkpoints: {} }),
    /checkpoint/iu,
  );
});

test('reported development pair has many disjoint six-current cohort triples', () => {
  const even = caseData(104002, FAMILIES[0]);
  const odd = caseData(104003, FAMILIES[0]);
  const current = new Set(even.current.keys());
  for (let nonce = 0; nonce < 8; nonce += 1) {
    const catalog = buildCoupledCatalog(even.index, {
      ...options(even, odd, nonce),
      pairSeed: 104002,
    });
    const sixCurrent = catalog.containment_cohorts.cohorts
      .map((group) => new Set(group.selectors.map(key)))
      .filter((members) => [...members].filter((selector) => current.has(selector)).length === 6);
    let disjointTriples = 0;
    for (let first = 0; first < sixCurrent.length; first += 1) {
      for (let second = first + 1; second < sixCurrent.length; second += 1) {
        if ([...sixCurrent[first]].some((selector) => sixCurrent[second].has(selector))) {
          continue;
        }
        for (let third = second + 1; third < sixCurrent.length; third += 1) {
          if (
            [...sixCurrent[third]].every(
              (selector) => !sixCurrent[first].has(selector) && !sixCurrent[second].has(selector),
            )
          ) {
            disjointTriples += 1;
          }
        }
      }
    }
    assert.ok(
      sixCurrent.length >= 12,
      `nonce ${nonce}: only ${sixCurrent.length} six-current groups`,
    );
    assert.ok(disjointTriples >= 4, `nonce ${nonce}: only ${disjointTriples} disjoint triples`);
  }
});

test('the planted triple has at least three non-completable rivals and no safe complement', () => {
  const even = caseData(104004, FAMILIES[0]);
  const odd = caseData(104005, FAMILIES[0]);
  for (let nonce = 0; nonce < 4; nonce += 1) {
    const catalog = buildCoupledCatalog(even.index, {
      ...options(even, odd, nonce),
      pairSeed: 104004,
    });
    const witness = catalog.witnesses.even
      .filter((command) => command.tool === 'quarantine-cohort')
      .map((command) => command.args.cohort_id)
      .sort()
      .join('|');
    for (const variant of [even, odd]) {
      const current = new Set(variant.current.keys());
      const qSix = catalog.containment_cohorts.cohorts
        .map((group) => ({
          id: group.cohort_id,
          current: group.selectors.map(key).filter((selector) => current.has(selector)),
          archive: group.selectors.map(key).filter((selector) => !current.has(selector)),
        }))
        .filter((group) => group.current.length === 6);
      const allSafe = qSix.filter((group) =>
        group.current.every((selector) => !variant.unsafe.has(selector)),
      );
      const alternatives = new Set();
      for (let a = 0; a < qSix.length; a += 1) {
        for (let b = a + 1; b < qSix.length; b += 1) {
          for (let c = b + 1; c < qSix.length; c += 1) {
            const triple = [qSix[a], qSix[b], qSix[c]];
            if (
              new Set(triple.flatMap((group) => group.current)).size !== 18 ||
              new Set(triple.flatMap((group) => group.archive)).size !== 6
            ) {
              continue;
            }
            const completable = qSix.some(
              (group) =>
                !triple.includes(group) &&
                new Set([...triple, group].flatMap((entry) => entry.current)).size === 24 &&
                new Set([...triple, group].flatMap((entry) => entry.archive)).size === 8,
            );
            const ids = triple
              .map((group) => group.id)
              .sort()
              .join('|');
            if (!completable && ids !== witness) {
              alternatives.add(ids);
            }
          }
        }
      }
      assert.equal(allSafe.length, 0, `nonce ${nonce}: ${allSafe.length} all-safe groups`);
      assert.ok(
        alternatives.size >= 3,
        `nonce ${nonce}: only ${alternatives.size} non-completable rival triples`,
      );
    }
  }
});

test('the paired witness triple has several structurally plausible exception pairs', () => {
  const even = caseData(104002, FAMILIES[0]);
  const odd = caseData(104003, FAMILIES[0]);
  const current = new Set(even.current.keys());
  const catalog = buildCoupledCatalog(even.index, {
    ...options(even, odd, 0),
    pairSeed: 104002,
  });
  const witnessIds = new Set(
    catalog.witnesses.even
      .filter((command) => command.tool === 'quarantine-cohort')
      .map((command) => command.args.cohort_id),
  );
  const witnessCurrent = new Set(
    catalog.containment_cohorts.cohorts
      .filter((group) => witnessIds.has(group.cohort_id))
      .flatMap((group) => group.selectors.map(key))
      .filter((selector) => current.has(selector)),
  );
  const bundles = catalog.exception_bundles.bundles.map((group) => ({
    current: new Set(group.selectors.map(key).filter((selector) => current.has(selector))),
    archive: new Set(group.selectors.map(key).filter((selector) => !current.has(selector))),
  }));
  let plausiblePairs = 0;
  for (const larger of bundles.filter((bundle) => bundle.current.size === 3)) {
    for (const smaller of bundles.filter((bundle) => bundle.current.size === 2)) {
      if (
        [...larger.current].every((selector) => witnessCurrent.has(selector)) &&
        [...smaller.current].every((selector) => larger.current.has(selector)) &&
        [...larger.archive].every((selector) => !smaller.archive.has(selector))
      ) {
        plausiblePairs += 1;
      }
    }
  }
  assert.ok(plausiblePairs >= 3, `only ${plausiblePairs} plausible exception pairs`);
});

test('paired witnesses and visible solver require the corresponding exception', () => {
  const [even, odd] = pair();
  const catalogs = buildCoupledCatalog(even.index, options(even, odd));
  for (const [variant, data, wrong] of [
    ['even', even, 'odd'],
    ['odd', odd, 'even'],
  ]) {
    const witness = catalogs.witnesses[variant];
    assert.equal(witness.length, 4);
    assert.equal(witness.filter((command) => command.tool === 'quarantine-cohort').length, 3);
    assert.equal(witness.filter((command) => command.tool === 'except-cohort').length, 1);
    assert.deepEqual(blockedFrom(witness, catalogs, data.current), data.unsafe);
    assert.equal(exactNativePlan(witness, catalogs, data.current, data.unsafe), true);
    const wrongBundle = catalogs.witnesses[wrong].find(
      (command) => command.tool === 'except-cohort',
    );
    assert.notDeepEqual(
      blockedFrom([...witness.slice(0, 3), wrongBundle], catalogs, data.current),
      data.unsafe,
    );
    const planned = solveMixedCover(catalogs, data.current, data.required);
    assert.ok(planned);
    assert.ok(planned.length <= 4);
    assert.deepEqual(blockedFrom(planned, catalogs, data.current), data.unsafe);
    assert.deepEqual(
      solveMixedCover(catalogs, data.current, [...data.required].reverse()),
      planned,
    );
  }
});

test('same effective coverage retains distinct raw occupancy, including exempted members', () => {
  const [even, odd] = pair();
  const catalogs = buildCoupledCatalog(even.index, options(even, odd));
  const cohorts = catalogs.containment_cohorts.cohorts.map(
    (group) => new Set(group.selectors.map(key).filter((k) => even.current.has(k))),
  );
  let required;
  for (const bundle of catalogs.exception_bundles.bundles) {
    const exempt = new Set(bundle.selectors.map(key));
    const coverage = (members) =>
      [...members]
        .filter((k) => !exempt.has(k))
        .sort()
        .join('|');
    const equivalent = new Map();
    for (const members of cohorts) {
      const signature = coverage(members);
      if (!signature) {
        continue;
      }
      for (const earlier of equivalent.get(signature) ?? []) {
        const third = cohorts.find(
          (other) =>
            coverage(other) &&
            [...other].some((k) => earlier.has(k)) &&
            [...other].every((k) => !members.has(k)),
        );
        if (third) {
          required = new Set([...members, ...third].filter((k) => !exempt.has(k)));
          break;
        }
      }
      if (required) {
        break;
      }
      if (!equivalent.has(signature)) {
        equivalent.set(signature, []);
      }
      equivalent.get(signature).push(members);
    }
    if (required) {
      break;
    }
  }
  assert.ok(required, 'fixture contains equal effective coverage with different raw occupancy');
  const plan = solveMixedCover(
    catalogs,
    even.current,
    [...required].map((selector) => even.current.get(selector)),
    { maxActions: 3 },
  );
  assert.ok(plan, 'a legal alternate three-request plan exists');
  assert.ok(plan.length <= 3);
  assert.equal(exactNativePlan(plan, catalogs, even.current, required), true);
});

test('mixed Q, E, and direct plans agree with independent exhaustive replay for small controls', () => {
  const [even, odd] = pair();
  const catalogs = buildCoupledCatalog(even.index, options(even, odd));
  const selectors = [...even.current.keys()].sort();
  const bulk = catalogs.witnesses.even[0];
  const bulkRequired = currentOccupancy([bulk], catalogs, even.current);
  const group = catalogs.exception_bundles.bundles.find((e) => {
    const members = e.selectors.map(key);
    return bulkRequired.filter((k) => members.includes(k)).length >= 2;
  });
  const exemptJobOrSession = bulkRequired.find((k) => group.selectors.map(key).includes(k));
  const directPlan = [
    bulk,
    { tool: 'except-cohort', args: { exception_id: group.exception_id } },
    even.current.get(exemptJobOrSession),
  ];
  const withDirectOverlap = blockedFrom(directPlan, catalogs, even.current);
  assert.equal(exactNativePlan(directPlan, catalogs, even.current, withDirectOverlap), true);
  for (const required of [
    new Set(),
    new Set(selectors.slice(0, 1)),
    new Set(selectors.slice(0, 2)),
    new Set(selectors.slice(0, 3)),
    new Set(bulkRequired),
    new Set([...bulkRequired, selectors.find((k) => !bulkRequired.includes(k))]),
    withDirectOverlap,
  ]) {
    const actions = [...required].map((selector) => even.current.get(selector));
    const plan = solveMixedCover(catalogs, even.current, actions, { maxActions: 3 });
    assert.equal(plan?.length ?? null, exhaustiveMinimumLength(catalogs, even.current, required));
    if (plan) {
      assert.equal(exactNativePlan(plan, catalogs, even.current, required), true);
    }
  }
});

test('a deterministic nonce denies every four-request plan without an exception', () => {
  for (const family of FAMILIES) {
    const [even, odd] = pair(family);
    let accepted = null;
    for (let nonce = 0; nonce < 40; nonce += 1) {
      const catalog = buildCoupledCatalog(even.index, options(even, odd, nonce, family));
      if (
        solveNoExceptionCover(catalog, even.current, even.required) === null &&
        solveNoExceptionCover(catalog, odd.current, odd.required) === null
      ) {
        accepted = catalog;
        break;
      }
    }
    assert.ok(accepted, `${family}: bounded nonce search`);
    assert.equal(solveMixedCover(accepted, even.current, even.required).length, 4);
    assert.equal(solveMixedCover(accepted, odd.current, odd.required).length, 4);
    assert.equal(solveMixedCover(accepted, even.current, even.required, { maxActions: 3 }), null);
    assert.equal(solveMixedCover(accepted, odd.current, odd.required, { maxActions: 3 }), null);
    assert.equal(
      hasIndependentThreeRequestExceptionShortcut(accepted, even.current, even.unsafe),
      false,
      `${family}: even three-request Q/E shortcut`,
    );
    assert.equal(
      hasIndependentThreeRequestExceptionShortcut(accepted, odd.current, odd.unsafe),
      false,
      `${family}: odd three-request Q/E shortcut`,
    );
  }
});

test('solver may choose an alternative valid plan and handles empty requirements', () => {
  const [even, odd] = pair();
  const catalog = buildCoupledCatalog(even.index, options(even, odd));
  const one = even.required.slice(0, 1);
  const plan = solveMixedCover(catalog, even.current, one, { maxActions: 1 });
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.deepEqual(
    blockedFrom(plan, catalog, even.current),
    new Set([
      [...even.current].find(([, action]) => JSON.stringify(action) === JSON.stringify(one[0]))[0],
    ]),
  );
  assert.deepEqual(solveMixedCover(catalog, even.current, [], { maxActions: 0 }), []);
  assert.deepEqual(solveNoExceptionCover(catalog, even.current, [], { maxActions: 0 }), []);
});

test('planner rejects a partial current map that hides approved collateral', () => {
  const [even, odd] = pair();
  const catalog = buildCoupledCatalog(even.index, options(even, odd));
  const partial = new Map([...even.current].filter(([selector]) => even.unsafe.has(selector)));
  assert.equal(partial.size, 15);
  assert.throws(
    () => solveMixedCover(catalog, partial, even.required),
    /24 current|twelve current|current action map/iu,
  );
  assert.throws(
    () => solveNoExceptionCover(catalog, partial, even.required),
    /24 current|twelve current|current action map/iu,
  );
  const wrongKinds = new Map(even.current);
  wrongKinds.delete([...wrongKinds.keys()].find((selector) => selector.startsWith('session:')));
  const archivedJob = catalog.containment_cohorts.candidates.find(
    (selector) => selector.kind === 'job' && !wrongKinds.has(`job:${selector.id}`),
  );
  wrongKinds.set(`job:${archivedJob.id}`, {
    tool: 'pause-job',
    args: { job_uid: archivedJob.id },
  });
  assert.equal(wrongKinds.size, 24);
  assert.throws(
    () => solveMixedCover(catalog, wrongKinds, even.required),
    /twelve current|12 current|current action map/iu,
  );
});

test('builder rejects malformed paired sets and validation catches catalog corruption', () => {
  const [even, odd] = pair();
  const args = options(even, odd);
  assert.throws(() => buildCoupledCatalog(even.index, { ...args, nonce: -1 }), /nonce/iu);
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, currentKeys: new Set() }),
    /current/iu,
  );
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, oddUnsafeKeys: even.unsafe }),
    /unsafe|flip/iu,
  );
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, evenUnsafeKeys: odd.unsafe }),
    /unsafe|flip/iu,
  );
  const catalog = buildCoupledCatalog(even.index, args);
  const bad = structuredClone(catalog);
  bad.containment_cohorts.cohorts[0].selectors[0] = bad.containment_cohorts.cohorts[0].selectors[1];
  assert.throws(() => validateCoupledCatalog(bad), /duplicate/iu);
  const badId = structuredClone(catalog);
  badId.exception_bundles.bundles[0].exception_id = 'exception-leaky';
  assert.throws(() => validateCoupledCatalog(badId), /exception|opaque/iu);
  const badDegree = structuredClone(catalog);
  badDegree.exception_bundles.bundles[0].selectors[0] =
    badDegree.exception_bundles.bundles[1].selectors[0];
  assert.throws(() => validateCoupledCatalog(badDegree), /degree|duplicate/iu);
  const repeatedMembership = structuredClone(catalog);
  repeatedMembership.containment_cohorts.cohorts[1].selectors = structuredClone(
    repeatedMembership.containment_cohorts.cohorts[0].selectors,
  );
  assert.throws(() => validateCoupledCatalog(repeatedMembership), /duplicate group membership/iu);
  assert.throws(
    () => solveMixedCover(catalog, new Map([['job:outside', even.required[0]]]), even.required),
    /current/iu,
  );
  assert.throws(
    () =>
      solveMixedCover(catalog, even.current, [{ tool: 'pause-job', args: { job_uid: 'outside' } }]),
    /required/iu,
  );
  assert.throws(
    () => solveMixedCover(catalog, even.current, even.required, { maxActions: -1 }),
    /maxActions/iu,
  );
});

test('visible staged planner rejects incomplete, ambiguous and ineffective choices', async () => {
  const { chooseStagedQuarantine, chooseStagedException } = await import('./staged_plan.mjs');
  const [even, odd] = pair();
  const args = options(even, odd);
  const { checkpoints } = args;
  let catalogs;
  for (let nonce = 0; nonce < 256; nonce++) {
    const candidate = buildCoupledCatalog(even.index, { ...args, nonce });
    if (hasUniqueStagedPlans(candidate, checkpoints, even.unsafe, odd.unsafe)) {
      catalogs = candidate;
      break;
    }
  }
  assert.ok(catalogs);
  // Model/reference API crosses a serialization boundary with only public data.
  const visible = JSON.parse(
    JSON.stringify({
      containment_cohorts: catalogs.containment_cohorts,
      exception_bundles: catalogs.exception_bundles,
    }),
  );
  const prior = [];
  for (const [stage, ordinal] of [20, 24, 30].entries()) {
    const rows = checkpoints[ordinal];
    const cmd = chooseStagedQuarantine(visible, rows, prior);
    assert.deepEqual(cmd, catalogs.witnesses.even[stage]);
    const ambiguous = structuredClone(visible);
    const cohort = ambiguous.containment_cohorts.cohorts.find(
      (g) => g.cohort_id === cmd.args.cohort_id,
    );
    ambiguous.containment_cohorts.cohorts.push({ ...cohort, cohort_id: 'other' });
    assert.equal(chooseStagedQuarantine(ambiguous, rows, prior), null);
    prior.push(cmd.args.cohort_id);
  }
  assert.equal(chooseStagedQuarantine(visible, {}, []), null);
  for (const [name, data] of [
    ['even', even],
    ['odd', odd],
  ]) {
    const rows = Object.fromEntries(
      [...data.current.keys()].map((k) => [
        k,
        { status: data.unsafe.has(k) ? 'unsafe' : 'approved' },
      ]),
    );
    const cmd = chooseStagedException(visible, rows, prior);
    assert.deepEqual(cmd, catalogs.witnesses[name][3]);
    assert.equal(chooseStagedException(visible, checkpoints[30], prior), null);
    assert.equal(chooseStagedException(visible, rows, [prior[0], ...prior.slice(0, 2)]), null);
    const overbroad = structuredClone(visible);
    const bundle = overbroad.exception_bundles.bundles.find(
      (e) => e.exception_id === cmd.args.exception_id,
    );
    const outside = [...data.current.keys()].find(
      (k) =>
        !currentOccupancy(catalogs.witnesses[name].slice(0, 3), catalogs, data.current).includes(k),
    );
    const filler = bundle.selectors.findIndex((s) => !data.current.has(key(s)));
    bundle.selectors[filler] = overbroad.containment_cohorts.candidates.find(
      (s) => key(s) === outside,
    );
    assert.deepEqual(chooseStagedException(overbroad, rows, prior), cmd);
    const ambiguous = structuredClone(visible);
    const e = ambiguous.exception_bundles.bundles.find(
      (g) => g.exception_id === cmd.args.exception_id,
    );
    ambiguous.exception_bundles.bundles.push({ ...e, exception_id: 'other' });
    assert.equal(chooseStagedException(ambiguous, rows, prior), null);
    assert.equal(
      chooseStagedException({ ...visible, exception_bundles: { bundles: [] } }, rows, prior),
      null,
    );
  }
});

test('catalog and schedule admit several competing staged sequences without authorization facts', () => {
  const [even, odd] = pair();
  const args = options(even, odd);
  const catalog = buildCoupledCatalog(even.index, args);
  const witness = catalog.witnesses.even.slice(0, 3).map((cmd) => cmd.args.cohort_id);
  const flip = [...odd.unsafe].find((key) => !even.unsafe.has(key));
  const shapes = catalog.containment_cohorts.cohorts
    .map((q) => ({
      id: q.cohort_id,
      members: q.selectors.map(key).filter((k) => even.current.has(k)),
    }))
    .filter((q) => q.members.length === 6);
  const occupied = new Set();
  for (const [stage, ordinal] of [20, 24, 30].entries()) {
    const rivals = shapes.filter(
      (q) =>
        q.id !== witness[stage] &&
        q.members.every((k) => !occupied.has(k)) &&
        q.members.filter((k) => args.checkpoints[ordinal][k].status === 'unresolved').length ===
          (stage === 2 ? 1 : 0) &&
        (stage !== 2 || q.members.includes(flip)),
    );
    assert.ok(rivals.length >= 3, 'ordinal ' + ordinal + ' has ' + rivals.length + ' rivals');
    for (const k of shapes.find((q) => q.id === witness[stage]).members) {
      occupied.add(k);
    }
  }
});
