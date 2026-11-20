import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV27Episode } from '../v27/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';

test('v28 expansion leaves the prior six-Job live-session deadline intact', () => {
  for (const family of FAMILIES) {
    const { visible, native } = buildV27Episode({ seed: 90000, family });
    assert.equal(native.jobs.length, 6);
    assert.equal(native.action_budget, 8);
    for (const session of visible.session_register.filter((item) => item.liveness === 'live')) {
      assert.equal(session.expires_at, visible.triage_time + 9);
    }
  }
});

test('v28 gives twelve Jobs twenty-four planned reads and a valid bounded solution', () => {
  for (const seed of [90000, 90001, 90002, 90003]) {
    for (const family of FAMILIES) {
      const spec = { seed, family };
      const { native, visible } = buildEpisode(spec);
      assert.equal(native.jobs.length, 12);
      assert.equal(native.attempts.length, 24);
      assert.equal(native.jobs.filter((item) => item.kind === 'release').length, 6);
      assert.equal(native.jobs.filter((item) => item.kind === 'scheduled').length, 6);
      assert.equal(visible.job_queue.length, 12);
      assert.equal(native.action_budget, 14);
      const session = buildDefenseSession(spec);
      assert.equal(session.initial.action_budget, 14);
      const actions = referenceDefense(session);
      assert.equal(actions.length, seed % 2 === 0 ? 13 : 14, `${seed}/${family}`);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.invalid_actions, 0);
      assert.equal(score.blocked_approved_attempt_count, 0);
      assert.ok(score.query_count <= 32);
    }
  }
});

test('v28 pair shares evidence and changes exactly one current approval and action', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 90000, family }).visible;
    const odd = buildEpisode({ seed: 90001, family }).visible;
    assert.deepEqual(even.events, odd.events);
    assert.deepEqual(even.approval_publications, odd.approval_publications);
    assert.deepEqual(even.membership_audit, odd.membership_audit);
    assert.deepEqual(even.session_register, odd.session_register);
    assert.deepEqual(even.job_queue, odd.job_queue);
    const left = resolveCurrentApprovals(even);
    const right = resolveCurrentApprovals(odd);
    assert.equal(
      left.filter((item, index) => JSON.stringify(item) !== JSON.stringify(right[index])).length,
      1,
    );
    const evenActions = referenceDefense(buildDefenseSession({ seed: 90000, family }));
    const oddActions = referenceDefense(buildDefenseSession({ seed: 90001, family }));
    const added = oddActions.filter(
      (item) => !evenActions.some((other) => JSON.stringify(other) === JSON.stringify(item)),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].tool, 'pause-job');
  }
});
