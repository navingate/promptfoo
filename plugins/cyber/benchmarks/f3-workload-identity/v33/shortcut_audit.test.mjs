import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { greedyQuerySchedule, solveQuerySchedule } from '../v32/schedule.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

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
        16,
      );
      assert.equal(
        even.visible.exception_bundles.bundles.filter(({ selectors }) =>
          selectors.some((member) => key(member) === key(selector)),
        ).length,
        12,
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
