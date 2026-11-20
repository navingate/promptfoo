import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';

test('v25 requires seven or eight exact controls and remains query-solvable', () => {
  for (const seed of [80000, 80001, 80002, 80003]) {
    for (const family of FAMILIES) {
      const spec = { seed, family };
      const session = buildDefenseSession(spec);
      const actions = referenceDefense(session);
      assert.equal(actions.length, seed % 2 === 0 ? 7 : 8, `${seed}/${family}`);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.blocked_approved_attempt_count, 0);
      assert.ok(score.query_count <= 32);
    }
  }
});

test('v25 expired grants are visible, native-matched, and denied at planned time', () => {
  for (const family of FAMILIES) {
    const { visible, native } = buildEpisode({ seed: 80000, family });
    const attempts = replayContainment(native, []).attempt_results;
    const nativeAttempts = new Map(native.attempts.map((item) => [item.attempt_id, item]));
    const current = resolveCurrentApprovals(visible);
    const nativeSnapshots = new Map(
      native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
    );
    let expired = 0;
    for (const approval of current) {
      const nativeGrants = nativeSnapshots.get(approval.snapshot_ref)?.grants;
      assert.deepEqual(nativeGrants, approval.grants);
      for (const grant of approval.grants) {
        const matchingAttempt = attempts.find(
          (attempt) =>
            attempt.job_uid === approval.job_uid &&
            nativeAttempts.get(attempt.attempt_id)?.resource === grant.task.remote_ref &&
            grant.scope.valid_until < attempt.event_time &&
            grant.scope.valid_until >= attempt.event_time - 7,
        );
        if (matchingAttempt) {
          assert.equal(matchingAttempt.job_approved, false);
          expired += 1;
        }
      }
    }
    assert.ok(expired >= 1, family);
  }
});

test('v25 pair changes one effective grant and one renewal control', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 80000, family }).visible;
    const odd = buildEpisode({ seed: 80001, family }).visible;
    assert.deepEqual(even.events, odd.events);
    assert.deepEqual(even.approval_publications, odd.approval_publications);
    assert.deepEqual(even.session_register, odd.session_register);
    assert.deepEqual(even.job_queue, odd.job_queue);
    const left = resolveCurrentApprovals(even);
    const right = resolveCurrentApprovals(odd);
    assert.equal(
      left.filter((item, index) => JSON.stringify(item) !== JSON.stringify(right[index])).length,
      1,
    );
    const evenActions = referenceDefense(buildDefenseSession({ seed: 80000, family }));
    const oddActions = referenceDefense(buildDefenseSession({ seed: 80001, family }));
    const added = oddActions.filter(
      (action) => !evenActions.some((other) => JSON.stringify(other) === JSON.stringify(action)),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].tool, 'pause-job');
  }
});
