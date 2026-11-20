import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { greedyQuerySchedule, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { hasUniqueStagedPlans } from './catalog.mjs';
import { resolvePrefix } from './prefix.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';
import { chooseStagedException, chooseStagedQuarantine } from './staged_plan.mjs';

function fixtureEpisode(spec) {
  return buildEpisode(spec, { catalogKey: '01'.repeat(32) });
}

const POLICIES = ['index', 'lexicographic', 'earliest-deadline', 'earliest-opening', 'topological'];

function key(selector) {
  return `${selector.kind}:${selector.id}`;
}

function currentKeys(visible) {
  return new Set([
    ...visible.job_queue.map(({ job_uid }) => `job:${job_uid}`),
    ...visible.session_register.map(({ access_key_ref }) => `session:${access_key_ref}`),
  ]);
}

function groupDensity(groups, current) {
  return groups.map(
    ({ selectors }) => selectors.filter((selector) => current.has(key(selector))).length,
  );
}

test('paired development cases retain the scheduled evidence trap and catalog ambiguity', () => {
  for (const family of FAMILIES) {
    const even = fixtureEpisode({ seed: 104000, family });
    const odd = fixtureEpisode({ seed: 104001, family });
    const current = currentKeys(even.visible);
    assert.deepEqual(current, currentKeys(odd.visible));
    assert.equal(current.size, 24);
    const index = {
      ...listWorkloads(even.visible),
      query_access_schedule: even.visible.query_access_schedule,
    };
    assert.equal(solveQuerySchedule(index).length, 30);
    for (const policy of POLICIES) {
      assert.equal(greedyQuerySchedule(index, policy), null, `${family}: ${policy}`);
    }

    const qDensity = groupDensity(even.visible.containment_cohorts.cohorts, current);
    const eDensity = groupDensity(even.visible.exception_bundles.bundles, current);
    assert.ok(qDensity.filter((count) => count === 6).length > 3, `${family}: Q density`);
    assert.ok(eDensity.filter((count) => count === 2).length > 1, `${family}: E density 2`);
    assert.ok(eDensity.filter((count) => count === 3).length > 1, `${family}: E density 3`);
    for (const selector of even.visible.containment_cohorts.candidates) {
      assert.equal(
        even.visible.containment_cohorts.cohorts.filter(({ selectors }) =>
          selectors.some((member) => key(member) === key(selector)),
        ).length,
        32,
      );
      assert.equal(
        even.visible.exception_bundles.bundles.filter(({ selectors }) =>
          selectors.some((member) => key(member) === key(selector)),
        ).length,
        24,
      );
    }
  }
});

test('no-action, fixed catalog guesses and broad revokes fail native scoring', () => {
  for (const family of FAMILIES) {
    for (const seed of [104000, 104001]) {
      const { visible, native } = fixtureEpisode({ seed, family });
      const q = visible.containment_cohorts.cohorts;
      const e = visible.exception_bundles.bundles;
      const guess = [
        ...q.slice(0, 3).map(({ cohort_id }) => ({
          tool: 'quarantine-cohort',
          args: { cohort_id },
        })),
        { tool: 'except-cohort', args: { exception_id: e[0].exception_id } },
      ];
      assert.equal(replayContainment(native, []).success, false, `${seed}/${family}: no action`);
      assert.equal(
        replayContainment(native, [
          { tool: 'except-cohort', args: { exception_id: e[0].exception_id } },
        ]).success,
        false,
        `${seed}/${family}: exception only`,
      );
      assert.equal(replayContainment(native, guess.slice(0, 3)).success, false);
      assert.equal(replayContainment(native, guess).success, false);
      const roleArns = new Set(visible.session_register.map(({ role_arn }) => role_arn));
      for (const role_arn of roleArns) {
        const score = replayContainment(native, [
          { tool: 'revoke-role-sessions', args: { role_arn } },
        ]);
        assert.equal(score.success, false);
        assert.ok(score.blocked_approved_attempt_count > 0);
      }
    }
  }
});

function assertArchiveDistribution(catalog, current, flip, pairs) {
  // The concentrated-pool shortcut requires twelve different current pairs
  // whose seven archive members all fit the same nine-selector pool.
  const pools = new Map();
  const archive = catalog.containment_cohorts.candidates.map(key).filter((k) => !current.has(k));
  for (const pair of pairs) {
    if (new Set(pair.archive).size !== 7 || pair.current.includes(flip)) {
      continue;
    }
    const extra = archive.filter((k) => !pair.archive.includes(k));
    for (let left = 0; left < extra.length; left++) {
      for (let right = left + 1; right < extra.length; right++) {
        const pool = [...pair.archive, extra[left], extra[right]].sort().join('|');
        if (!pools.has(pool)) {
          pools.set(pool, new Set());
        }
        pools.get(pool).add([...pair.current].sort().join('|'));
      }
    }
  }
  assert.ok(
    [...pools.values()].every((ids) => ids.size < 3),
    'shared nine-archive pool supports three paired exception motifs',
  );
}

function publicMotifs(catalog, current, flip, resolvable) {
  const currentKeys = (group) => group.selectors.map(key).filter((k) => current.has(k));
  const archiveKeys = (group) => group.selectors.map(key).filter((k) => !current.has(k));
  const groups = catalog.containment_cohorts.cohorts
    .map((q) => ({
      id: q.cohort_id,
      current: currentKeys(q),
      archive: archiveKeys(q),
    }))
    .filter((q) => q.current.length === 6);
  const bundles = catalog.exception_bundles.bundles.map((group) => ({
    id: group.exception_id,
    current: currentKeys(group),
    archive: archiveKeys(group),
  }));
  const pairs = [];
  for (const small of bundles.filter((group) => group.current.length === 2)) {
    for (const large of bundles.filter(
      (group) => group.current.length === 3 && group.current.includes(flip),
    )) {
      if (small.current.every((k) => large.current.includes(k))) {
        pairs.push({
          small: small.id,
          large: large.id,
          current: small.current,
          archive: [...small.archive, ...large.archive],
        });
      }
    }
  }
  assertArchiveDistribution(catalog, current, flip, pairs);
  for (const group of groups) {
    group.pairs = pairs.filter((pair) => pair.current.every((k) => group.current.includes(k)));
  }
  // Give the no-detail baseline the additional knowledge of exactly which
  // authorizations could be resolved by each deadline. Their values stay hidden.
  const stages = [20, 24, 30].map((n, i) =>
    groups.filter(
      (q) =>
        q.current.filter((k) => !resolvable[n].has(k)).length === (i === 2 ? 1 : 0) &&
        (i !== 2 || q.current.includes(flip)) &&
        (i !== 1 || pairs.some((pair) => pair.current.every((k) => q.current.includes(k)))),
    ),
  );
  const disjoint = (a, b) => a.current.every((k) => !b.current.includes(k));
  const sequences = [];
  for (const q1 of stages[0]) {
    for (const q2 of stages[1]) {
      if (!disjoint(q1, q2)) {
        continue;
      }
      for (const q3 of stages[2]) {
        if (disjoint(q1, q3) && disjoint(q2, q3)) {
          sequences.push([q1, q2, q3]);
        }
      }
    }
  }
  return sequences;
}

// Infer a possible private world solely from a public triple and an exception
// pair. Check the visible chooser on both final variants for every possible
// witness, before consulting any actual authorizations.
function possibleExceptionPairs(catalog, current, flip, resolvable, groups) {
  const ids = groups.map((g) => g.id);
  const supported = new Map();
  for (const pair of groups[1].pairs) {
    const odd = new Set(groups.flatMap((g) => g.current).filter((k) => !pair.current.includes(k)));
    const rows = (known, even = false) =>
      Object.fromEntries(
        [...current].map((k) => {
          const status = odd.has(k) && !(even && k === flip) ? 'unsafe' : 'approved';
          return [k, { status: known.has(k) ? status : 'unresolved' }];
        }),
      );
    const prefixMatches = [20, 24, 30].every(
      (ordinal, stage) =>
        chooseStagedQuarantine(catalog, rows(resolvable[ordinal]), ids.slice(0, stage))?.args
          .cohort_id === ids[stage],
    );
    if (
      prefixMatches &&
      chooseStagedException(catalog, rows(current), ids)?.args.exception_id === pair.small &&
      chooseStagedException(catalog, rows(current, true), ids)?.args.exception_id === pair.large
    ) {
      supported.set([...pair.current].sort().join('|'), pair);
    }
  }
  return [...supported.values()];
}

function assertCompletePublicGrid(catalog, current, flip, resolvable) {
  const possible = publicMotifs(catalog, current, flip, resolvable).filter(
    (groups) => possibleExceptionPairs(catalog, current, flip, resolvable, groups).length === 3,
  );
  assert.equal(possible.length, 64);
  // 64 distinct paths and four unique IDs at each stage imply the full
  // Cartesian product. All candidate prefixes have equal continuation counts.
  for (let stage = 0; stage < 3; stage++) {
    const counts = Map.groupBy(possible, (groups) => groups[stage].id);
    assert.equal(counts.size, 4);
    assert.ok([...counts.values()].every((paths) => paths.length === 16));
  }
  return possible;
}

// Substitute four disjoint choices as the private witness while keeping the
// public catalog byte-identical. A witness-conditioned rank test rejects some
// of these worlds, exposing that choice through the mere fact of acceptance.
function assertInterchangeableWitnesses(catalog, current, flip, known, possible) {
  const chosen = [new Set(), new Set(), new Set()];
  for (const groups of possible) {
    if (groups.some((group, i) => chosen[i].has(group.id))) {
      continue;
    }
    const [pair] = possibleExceptionPairs(catalog, current, flip, known, groups);
    const odd = new Set(groups.flatMap((g) => g.current).filter((k) => !pair.current.includes(k)));
    const even = new Set([...odd].filter((k) => k !== flip));
    const q = groups.map((group) => ({ tool: 'quarantine-cohort', args: { cohort_id: group.id } }));
    const plan = (id) => [...q, { tool: 'except-cohort', args: { exception_id: id } }];
    const checkpoints = Object.fromEntries(
      Object.entries(known).map(([ordinal, ready]) => [
        ordinal,
        Object.fromEntries(
          [...current].map((k) => {
            const status = odd.has(k) ? 'unsafe' : 'approved';
            return [k, { status: ready.has(k) ? status : 'unresolved' }];
          }),
        ),
      ]),
    );
    assert.equal(
      hasUniqueStagedPlans(
        { ...catalog, witnesses: { odd: plan(pair.small), even: plan(pair.large) } },
        checkpoints,
        even,
        odd,
      ),
      true,
    );
    groups.forEach((group, i) => chosen[i].add(group.id));
  }
  assert.ok(chosen.every((stage) => stage.size === 4));
}

test('public schedule, index, Q/E motifs and prefix resolvability leave multiple rival sequences', () => {
  const matches = { id: 0, order: 0, earliest: 0 };
  const grid = [
    ...FAMILIES.map((family) => ({ family, seed: 109000 })),
    { family: 'owner-reference', seed: 109002 },
  ];
  for (const { family, seed } of grid) {
    const { visible } = fixtureEpisode({ seed, family });
    const index = {
      ...listWorkloads(visible),
      query_access_schedule: visible.query_access_schedule,
    };
    const order = solveQuerySchedule(index);
    const flip = scheduleKey(order.at(-1));
    const positions = new Map(order.map((r, i) => [scheduleKey(r), i]));
    const read = { session: querySession, credential: querySource, job: queryWorkload };
    const replies = order.map((row) => ({
      ok: true,
      evidence: read[row.entry_type](visible, row.entry_id),
    }));
    const chosen = [];
    const resolvable = {};
    for (const ordinal of [20, 24, 30]) {
      const prefix = resolvePrefix(index, replies.slice(0, ordinal - 1));
      resolvable[ordinal] = new Set(
        Object.keys(prefix).filter((k) => prefix[k].status !== 'unresolved'),
      );
      chosen.push(chooseStagedQuarantine(visible, prefix, chosen).args.cohort_id);
    }
    const current = currentKeys(visible);
    const sequences = assertCompletePublicGrid(visible, current, flip, resolvable);
    const appeared = Object.fromEntries(
      [20, 24, 30].map((ordinal) => [
        ordinal,
        new Set(order.slice(0, ordinal - 1).map(scheduleKey)),
      ]),
    );
    const scheduleOnly = assertCompletePublicGrid(visible, current, flip, appeared);
    if (family === 'owner-reference' && seed === 109000) {
      assertInterchangeableWitnesses(visible, current, flip, appeared, scheduleOnly);
    }
    assert.ok(
      [sequences, scheduleOnly].every((paths) =>
        paths.some((groups) => groups.every((g, i) => g.id === chosen[i])),
      ),
    );
    const rankings = {
      id: (s) => s.map((g) => g.id).join('|'),
      order: (s) =>
        s
          .map((g) =>
            String(
              visible.containment_cohorts.cohorts.findIndex((q) => q.cohort_id === g.id),
            ).padStart(3, '0'),
          )
          .join('|'),
      earliest: (s) =>
        s
          .map((g) =>
            String(g.current.reduce((sum, k) => sum + positions.get(k), 0)).padStart(3, '0'),
          )
          .join('|'),
    };
    for (const [policy, rank] of Object.entries(rankings)) {
      const first = [...sequences].sort((a, b) => rank(a).localeCompare(rank(b)))[0];
      if (first.every((g, i) => g.id === chosen[i])) {
        matches[policy]++;
      }
    }
  }
  for (const [policy, count] of Object.entries(matches)) {
    assert.ok(count < grid.length, policy + ' identified every winning Q sequence');
  }
});
