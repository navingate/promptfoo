import assert from 'node:assert/strict';
import test from 'node:test';

import { replayContainment } from '../v19/runtime.mjs';
import { buildEpisode } from '../v20/producer.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';

test('one drained old request does not make shared-role retirement safe', () => {
  const episode = buildEpisode({ seed: 112000, family: 'reconcile-hook' });
  const untreated = replayContainment(episode.native, []);
  const approved = untreated.attempt_results.filter((attempt) => attempt.authorized);
  assert.equal(approved.length, 2);
  assert.equal(approved[0].kind, 'active');
  assert.equal(approved[1].kind, 'active');
  const first = episode.native.attempts.find(
    (attempt) => attempt.attempt_id === approved[0].attempt_id,
  );
  const second = episode.native.attempts.find(
    (attempt) => attempt.attempt_id === approved[1].attempt_id,
  );
  assert.equal(first.role_arn, second.role_arn);
  assert.notEqual(first.resource, second.resource);
  assert.ok(first.event_time < second.event_time);
  const secondSession = episode.visible.session_register.find(
    (session) => session.active_plan?.plan_ref === second.plan_ref,
  );
  assert.equal(secondSession?.role_arn, second.role_arn);
  assert.equal(secondSession.active_plan.resource, second.resource);
  assert.equal(secondSession.active_plan.planned_at, second.event_time);
  assert.ok(episode.visible.current_job_approvals.some((item) => item.job_uid === second.job_uid));

  // The first old request has drained. The second remains on the old role.
  const afterFirstDrain = structuredClone(episode.native);
  afterFirstDrain.attempts = afterFirstDrain.attempts.filter(
    (attempt) => attempt.attempt_id !== first.attempt_id,
  );
  const prematureRetirement = replayContainment(afterFirstDrain, [
    { tool: 'revoke-role-sessions', args: { role_arn: first.role_arn } },
  ]);
  assert.equal(prematureRetirement.success, false);
  assert.equal(prematureRetirement.unauthorized_completed, 0);
  assert.deepEqual(prematureRetirement.blocked_clean_attempts, [second.attempt_id]);

  // Exact controls from only the visible packet contain the bad sessions and
  // leave the approved request running; retirement can be deferred.
  const scoped = planReferenceContainment(episode.visible);
  const safe = replayContainment(episode.native, scoped);
  assert.equal(safe.success, true);
  assert.equal(safe.unauthorized_completed, 0);
  assert.equal(safe.blocked_clean_attempt_count, 0);
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every((action) => action.tool === 'deny-role-session'));
});
