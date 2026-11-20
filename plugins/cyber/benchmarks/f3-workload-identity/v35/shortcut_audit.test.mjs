import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { greedyQuerySchedule, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { resolvePrefix } from './prefix.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';
import { chooseStagedQuarantine } from './staged_plan.mjs';

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
    const even = buildEpisode({ seed: 104000, family });
    const odd = buildEpisode({ seed: 104001, family });
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
      const { visible, native } = buildEpisode({ seed, family });
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

function publicMotifs(catalog, current, flip, resolvable) {
  const currentKeys = (group) => group.selectors.map(key).filter((k) => current.has(k));
  const groups = catalog.containment_cohorts.cohorts
    .map((q) => ({
      id: q.cohort_id,
      current: currentKeys(q),
    }))
    .filter((q) => q.current.length === 6);
  const bundles = catalog.exception_bundles.bundles.map(currentKeys);
  const small = bundles.filter((m) => m.length === 2);
  const large = bundles.filter((m) => m.length === 3 && m.includes(flip));
  const pairs = small.filter((m) => large.some((l) => m.every((k) => l.includes(k))));
  // Give the no-detail baseline the additional knowledge of exactly which
  // authorizations could be resolved by each deadline. Their values stay hidden.
  const stages = [20, 24, 30].map((n, i) =>
    groups.filter(
      (q) =>
        q.current.filter((k) => !resolvable[n].has(k)).length === (i === 2 ? 1 : 0) &&
        (i !== 2 || q.current.includes(flip)) &&
        (i !== 1 || pairs.some((pair) => pair.every((k) => q.current.includes(k)))),
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

test('public schedule, index, Q/E motifs and prefix resolvability leave multiple rival sequences', () => {
  const matches = { id: 0, order: 0, earliest: 0 };
  for (const family of FAMILIES) {
    const { visible } = buildEpisode({ seed: 109000, family });
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
    const sequences = publicMotifs(visible, currentKeys(visible), flip, resolvable);
    const winners = sequences.filter((s) => s.every((g, i) => g.id === chosen[i]));
    assert.equal(winners.length, 1);
    for (let stage = 0; stage < 3; stage++) {
      const counts = Map.groupBy(
        sequences.filter((s) => s.slice(0, stage).every((g, i) => g.id === chosen[i])),
        (s) => s[stage].id,
      );
      const target = counts.get(chosen[stage]).length;
      const rivals = [...counts]
        .filter(([id]) => id !== chosen[stage])
        .map(([, seq]) => seq.length);
      assert.ok(
        rivals.some((count) => count >= target) && rivals.some((count) => count <= target),
        family +
          ' unique continuation rank for stage ' +
          (stage + 1) +
          ' (' +
          [target, ...rivals] +
          ')',
      );
      const changing = new Set(
        sequences
          .filter((s) => s.slice(0, stage).every((g, i) => g.id === chosen[i]))
          .map((s) => s[stage].id),
      );
      assert.ok(
        changing.size >= 4,
        family + ' at stage ' + (stage + 1) + ' had ' + changing.size + ' options',
      );
    }
    assert.ok(sequences.filter((s) => s.every((g, i) => g.id !== chosen[i])).length >= 3);
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
    assert.ok(count < FAMILIES.length, policy + ' identified every winning Q sequence');
  }
});
