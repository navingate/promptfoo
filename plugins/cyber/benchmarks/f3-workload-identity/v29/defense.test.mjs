import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildEpisode as buildV28Episode } from '../v28/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';

function outcomes(episode) {
  return new Map(
    replayContainment(episode.native, []).attempt_results.map((attempt) => [
      attempt.attempt_id,
      attempt,
    ]),
  );
}

test('v29 visibly changes two planned authorizations on the same Jobs in each pair', () => {
  for (const family of FAMILIES) {
    const flippedBySeed = [];
    for (const seed of [93000, 93001]) {
      const baseline = buildV28Episode({ seed, family });
      const episode = buildEpisode({ seed, family });
      const before = outcomes(baseline);
      const after = outcomes(episode);
      const flipped = [...after.values()].filter(
        (attempt) => before.get(attempt.attempt_id)?.authorized !== attempt.authorized,
      );
      assert.equal(flipped.length, 2, `${seed}/${family}`);
      assert.ok(flipped.every((attempt) => before.get(attempt.attempt_id)?.authorized));
      assert.deepEqual(flipped.map((attempt) => attempt.kind).sort(), ['active', 'renewal']);
      assert.equal(new Set(flipped.map((attempt) => attempt.job_uid)).size, 2);
      flippedBySeed.push(flipped.map((attempt) => `${attempt.job_uid}/${attempt.kind}`).sort());

      const expired = flipped.find((attempt) => attempt.kind === 'renewal');
      const pairedActive = after.get(
        episode.native.attempts.find(
          (attempt) => attempt.job_uid === expired.job_uid && attempt.kind === 'active',
        )?.attempt_id,
      );
      const priorApprovals = resolveCurrentApprovals(baseline.visible);
      const currentApprovals = resolveCurrentApprovals(episode.visible);
      const changedExpiry = currentApprovals
        .filter((approval) => approval.job_uid === expired.job_uid)
        .flatMap((approval) => approval.grants)
        .filter((grant) =>
          priorApprovals.some(
            (approval) =>
              approval.job_uid === expired.job_uid &&
              approval.grants.some(
                (prior) =>
                  prior.grant_id === grant.grant_id &&
                  prior.scope.valid_until !== grant.scope.valid_until,
              ),
          ),
        );
      assert.equal(changedExpiry.length, 1);
      assert.ok(
        pairedActive.event_time < changedExpiry[0].scope.valid_until &&
          changedExpiry[0].scope.valid_until < expired.event_time,
      );

      const nativeSnapshots = new Map(
        episode.native.grant_snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
      );
      for (const current of resolveCurrentApprovals(episode.visible)) {
        assert.deepEqual(
          current.grants,
          nativeSnapshots.get(current.snapshot_ref)?.grants,
          `${seed}/${family}/${current.snapshot_ref}`,
        );
      }
    }
    assert.deepEqual(flippedBySeed[0], flippedBySeed[1], family);
  }
});

test('v29 query-only reference protects approved work within the sixteen-action budget', () => {
  for (const seed of [93000, 93001, 93002, 93003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      assert.equal(session.initial.action_budget, 16);
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 16, `${seed}/${family}: ${actions.length}`);
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

test('v29 allows unrelated Jobs to have coincident authorization boundaries', () => {
  const spec = { seed: 93010, family: 'mutating-webhook' };
  const episode = buildEpisode(spec);
  assert.equal(episode.native.jobs.length, 12);
  const session = buildDefenseSession(spec);
  for (const action of referenceDefense(session)) {
    assert.equal(stepDefense(session, action).accepted, true);
  }
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
  assert.equal(scoreDefense(session).success, true);
});

test('v29 development pairs preserve one approval difference and native parity', () => {
  const auditKey = (event) =>
    [
      event.audit_stream_ref,
      event.kind,
      event.outcome,
      event.group_principal,
      event.member_principal,
      event.event_time,
      event.arrival_order,
    ].join('|');
  for (let pairSeed = 93000; pairSeed < 93012; pairSeed += 2) {
    for (const family of FAMILIES) {
      const even = buildEpisode({ seed: pairSeed, family });
      const odd = buildEpisode({ seed: pairSeed + 1, family });
      for (const key of [
        'events',
        'approval_publications',
        'membership_audit',
        'session_register',
        'job_queue',
      ]) {
        assert.deepEqual(even.visible[key], odd.visible[key], `${pairSeed}/${family}/${key}`);
      }
      const evenApprovals = resolveCurrentApprovals(even.visible);
      const oddApprovals = resolveCurrentApprovals(odd.visible);
      assert.equal(
        evenApprovals.filter(
          (approval, index) => JSON.stringify(approval) !== JSON.stringify(oddApprovals[index]),
        ).length,
        1,
        `${pairSeed}/${family}`,
      );
      for (const episode of [even, odd]) {
        const nativeSnapshots = new Map(
          episode.native.grant_snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
        );
        for (const approval of resolveCurrentApprovals(episode.visible)) {
          assert.deepEqual(approval.grants, nativeSnapshots.get(approval.snapshot_ref)?.grants);
        }
        assert.deepEqual(
          episode.visible.membership_audit.map(auditKey).sort(),
          episode.native.membership_ledger.map(auditKey).sort(),
        );
      }
    }
  }
});
