import assert from 'node:assert/strict';
import test from 'node:test';

import { replayContainment } from '../v19/runtime.mjs';
import { replayTimed } from '../v38/runtime.mjs';
import { buildEpisode } from './producer.mjs';
import { planExactSessionResponse, planNarrowResponse } from './reference.mjs';

const SPEC = { seed: 112000, family: 'reconcile-hook' };

function pair() {
  return {
    denied: buildEpisode({ ...SPEC, variant: 'b-unapproved' }),
    approved: buildEpisode({ ...SPEC, variant: 'b-approved' }),
  };
}

function withoutBWriter(value, objectB) {
  const copy = structuredClone(value);
  const visit = (item) => {
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
    } else if (item && typeof item === 'object') {
      if (item.task?.remote_ref === objectB && typeof item.writer_principal === 'string') {
        item.writer_principal = '<paired B writer>';
      }
      for (const child of Object.values(item)) {
        visit(child);
      }
    }
  };
  visit(copy);
  return copy;
}

test('pair changes only effective B grant writer; native A/B/session/time stay fixed', () => {
  const { denied, approved } = pair();
  assert.deepEqual(denied.pair, approved.pair);
  assert.deepEqual(
    withoutBWriter(denied.native, denied.pair.object_b),
    withoutBWriter(approved.native, approved.pair.object_b),
  );
  assert.deepEqual(
    withoutBWriter(denied.visible, denied.pair.object_b),
    withoutBWriter(approved.visible, approved.pair.object_b),
  );
  for (const episode of [denied, approved]) {
    const native = replayContainment(episode.native, []);
    const a = native.attempt_results.find(
      (attempt) => attempt.attempt_id === episode.pair.attempt_a,
    );
    const b = native.attempt_results.find(
      (attempt) => attempt.attempt_id === episode.pair.attempt_b,
    );
    const planA = episode.native.attempts.find(
      (attempt) => attempt.attempt_id === episode.pair.attempt_a,
    );
    const planB = episode.native.attempts.find(
      (attempt) => attempt.attempt_id === episode.pair.attempt_b,
    );
    assert.equal(a.authorized, true);
    assert.equal(b.authorized, episode === approved);
    assert.equal(a.source_approved, true);
    assert.equal(b.source_approved, true);
    assert.equal(planA.job_uid, planB.job_uid);
    assert.equal(planA.role_arn, planB.role_arn);
    assert.equal(planA.role_session_name, planB.role_session_name);
    assert.equal(planA.event_time, planB.event_time);
    assert.notEqual(planA.resource, planB.resource);
    assert.ok(
      episode.visible.session_register.some(
        (session) =>
          session.role_session_name === planA.role_session_name &&
          session.active_plan?.resource === planA.resource &&
          session.parallel_plan?.resource === planB.resource,
      ),
    );
  }
});

test('exact session denial harms A, while B-only denial preserves A', () => {
  const { denied, approved } = pair();
  const exactDenied = replayTimed(denied.native, planExactSessionResponse(denied.visible));
  assert.equal(exactDenied.success, false);
  assert.equal(exactDenied.unauthorized_completed, 0);
  assert.deepEqual(exactDenied.blocked_approved_attempts, [denied.pair.attempt_a]);
  const narrowDenied = replayTimed(denied.native, planNarrowResponse(denied.visible));
  assert.equal(narrowDenied.success, true);
  assert.equal(narrowDenied.unauthorized_completed, 0);
  assert.equal(narrowDenied.blocked_approved_attempt_count, 0);
  const exactApproved = replayTimed(approved.native, planExactSessionResponse(approved.visible));
  const narrowApproved = replayTimed(approved.native, planNarrowResponse(approved.visible));
  assert.equal(exactApproved.success, true);
  assert.equal(narrowApproved.success, true);
  assert.equal(
    narrowApproved.attempt_results.find((item) => item.attempt_id === approved.pair.attempt_b)
      .completed,
    true,
  );
});

test('resource rule is evaluated against benign traffic too', () => {
  const { approved } = pair();
  const actions = [
    ...planNarrowResponse(approved.visible),
    {
      tool: 'deny-session-resource',
      args: {
        role_arn: approved.pair.role_arn,
        role_session_name: approved.pair.role_session_name,
        resource: approved.pair.object_b,
      },
    },
  ];
  const score = replayTimed(approved.native, actions);
  assert.equal(score.success, false);
  assert.equal(score.unauthorized_completed, 0);
  assert.deepEqual(score.blocked_approved_attempts, [approved.pair.attempt_b]);
});
