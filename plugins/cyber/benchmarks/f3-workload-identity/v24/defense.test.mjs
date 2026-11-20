import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

test('v24 failed approval proposals do not publish the effective grants', () => {
  for (const seed of [75000, 75001, 75002, 75003]) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      const snapshots = new Map(
        visible.approval_snapshots.map((item) => [item.snapshot_ref, item]),
      );
      const nativeSnapshots = new Map(
        native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
      );
      let checked = 0;
      for (const failed of visible.approval_publications.filter(
        (item) => item.outcome === 'failed' && !item.failure_reason,
      )) {
        const completed = visible.approval_publications.find(
          (item) =>
            item.approval_stream_ref === failed.approval_stream_ref &&
            item.previous_snapshot_ref === failed.previous_snapshot_ref &&
            item.outcome === 'completed' &&
            item.event_time > failed.event_time,
        );
        assert.ok(completed);
        const failedGrants = snapshots.get(failed.new_snapshot_ref)?.grants;
        const effectiveGrants = snapshots.get(completed.new_snapshot_ref)?.grants;
        assert.ok(failedGrants);
        assert.ok(effectiveGrants);
        assert.notDeepEqual(failedGrants, effectiveGrants, `${seed}/${family}/${failed.event_id}`);
        assert.deepEqual(nativeSnapshots.get(failed.new_snapshot_ref)?.grants, failedGrants);
        checked += 1;
      }
      assert.ok(checked >= 12);
    }
  }
});

test('v24 gives every admitted Job both planned phases and a visible mixed approval', () => {
  for (const seed of [75000, 75001, 75002, 75003]) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      assert.equal(visible.session_register.length, 6);
      assert.equal(visible.job_queue.length, 6);
      assert.ok(visible.session_register.every((session) => session.active_plan));
      assert.ok(
        visible.job_queue.every((job) => job.credential_renewal_pending && job.renewal_plan),
      );
      const attempts = replayContainment(native, []).attempt_results;
      assert.equal(attempts.length, 12);
      const byJob = Map.groupBy(attempts, (attempt) => attempt.job_uid);
      assert.ok(
        [...byJob.values()].some(
          (reads) =>
            reads.length === 2 &&
            reads[0].source_approved === true &&
            reads.some((item) => item.authorized) &&
            reads.some((item) => !item.authorized),
        ),
      );
    }
  }
});

test('v24 counts an approved renewal blocked inside a mixed Job as collateral', () => {
  const episode = buildEpisode({ seed: 75000, family: FAMILIES[0] });
  const attempts = replayContainment(episode.native, []).attempt_results;
  const mixed = [...Map.groupBy(attempts, (attempt) => attempt.job_uid)].find(
    ([, reads]) =>
      reads.some((item) => item.kind === 'active' && !item.authorized) &&
      reads.some((item) => item.kind === 'renewal' && item.authorized),
  );
  assert.ok(mixed);
  const [jobUid] = mixed;
  const visible = {
    ...episode.visible,
    current_job_approvals: resolveCurrentApprovals(episode.visible),
  };
  const reference = planReferenceContainment(visible);
  assert.equal(replayContainment(episode.native, reference).success, true);
  const overbroad = replayContainment(episode.native, [
    ...reference,
    { tool: 'pause-job', args: { job_uid: jobUid } },
  ]);
  assert.equal(overbroad.threat_closed, true);
  assert.equal(overbroad.function_preserved, false);
  assert.ok(
    overbroad.blocked_approved_attempts.some((id) =>
      attempts.some(
        (item) => item.attempt_id === id && item.job_uid === jobUid && item.kind === 'renewal',
      ),
    ),
  );
});

test('v24 query-only reference closes every planned unsafe read and preserves approved work', () => {
  for (const seed of [75000, 75001, 75002, 75003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 8);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.blocked_approved_attempts.length, 0);
      assert.ok(score.query_count <= 32);
    }
  }
});

test('v24 counterfactual pair changes one approval and one renewal action', () => {
  for (const family of FAMILIES) {
    const evenSpec = { seed: 75000, family };
    const oddSpec = { seed: 75001, family };
    const even = buildEpisode(evenSpec).visible;
    const odd = buildEpisode(oddSpec).visible;
    assert.deepEqual(even.events, odd.events);
    assert.deepEqual(even.approval_publications, odd.approval_publications);
    assert.deepEqual(even.session_register, odd.session_register);
    assert.deepEqual(even.job_queue, odd.job_queue);
    const left = resolveCurrentApprovals(even);
    const right = resolveCurrentApprovals(odd);
    const changed = left.filter(
      (item, index) => JSON.stringify(item) !== JSON.stringify(right[index]),
    );
    assert.equal(changed.length, 1);
    const evenActions = referenceDefense(buildDefenseSession(evenSpec));
    const oddActions = referenceDefense(buildDefenseSession(oddSpec));
    const added = oddActions.filter(
      (action) => !evenActions.some((other) => JSON.stringify(other) === JSON.stringify(action)),
    );
    assert.deepEqual(added, [{ tool: 'pause-job', args: { job_uid: changed[0].job_uid } }]);
  }
});
