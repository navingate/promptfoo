import assert from 'node:assert/strict';
import { test } from 'node:test';

import { replayContainment } from './runtime.mjs';

function grant(resource, overrides = {}) {
  return {
    grant_id: `grant-${resource}`,
    writer_principal: 'worker',
    task: { action: 's3:GetObject', remote_ref: resource },
    scope: {
      service_account_id: 'shared-sa',
      template_id: 'approved-template',
      valid_from: 0,
      valid_until: 100,
    },
    ...overrides,
  };
}

function fixture({
  badActive = true,
  badRenewal = false,
  goodRenewal = false,
  badHistoricalAuthorized = true,
} = {}) {
  const jobs = [
    {
      job_uid: 'job-bad',
      actor: 'worker',
      service_account_id: 'shared-sa',
      template_id: 'approved-template',
      role_arn: 'arn:aws:iam::123456789012:role/shared',
      change: { base_snapshot_ref: 'bad-change', approval_stream_ref: 'bad-change-stream' },
      owner: { base_snapshot_ref: 'bad-owner', approval_stream_ref: 'bad-owner-stream' },
      nativeActionRecords: { captured: { authorized: badHistoricalAuthorized } },
    },
    {
      job_uid: 'job-good',
      actor: 'worker',
      service_account_id: 'shared-sa',
      template_id: 'approved-template',
      role_arn: 'arn:aws:iam::123456789012:role/shared',
      change: { base_snapshot_ref: 'good-change', approval_stream_ref: 'good-change-stream' },
      owner: { base_snapshot_ref: 'good-owner', approval_stream_ref: 'good-owner-stream' },
    },
  ];
  const grant_snapshots = jobs.flatMap((job) =>
    ['change', 'owner'].map((lane) => ({
      snapshot_ref: job[lane].base_snapshot_ref,
      approval_stream_ref: job[lane].approval_stream_ref,
      audit_stream_ref: 'membership-audit',
      grants:
        job.job_uid === 'job-good' ? [grant('object-good'), grant('object-good-renewed')] : [],
    })),
  );
  const sessions = [
    {
      job_uid: 'job-bad',
      role_arn: jobs[0].role_arn,
      role_session_name: 'bad-issued',
      issued_at: 4,
      expires_at: 90,
    },
    {
      job_uid: 'job-good',
      role_arn: jobs[1].role_arn,
      role_session_name: 'good-issued',
      issued_at: 5,
      expires_at: 90,
    },
  ];
  const attempts = [
    ...(badActive
      ? [
          {
            attempt_id: 'bad-active',
            job_uid: 'job-bad',
            kind: 'active',
            event_time: 20,
            action: 's3:GetObject',
            resource: 'object-bad',
            role_arn: jobs[0].role_arn,
            role_session_name: 'bad-issued',
            iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'shared-policy' },
          },
        ]
      : []),
    {
      attempt_id: 'good-active',
      job_uid: 'job-good',
      kind: 'active',
      event_time: 21,
      action: 's3:GetObject',
      resource: 'object-good',
      role_arn: jobs[1].role_arn,
      role_session_name: 'good-issued',
      iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'shared-policy' },
    },
    ...(badRenewal
      ? [
          {
            attempt_id: 'bad-renewal',
            job_uid: 'job-bad',
            kind: 'renewal',
            event_time: 30,
            action: 's3:GetObject',
            resource: 'object-bad-renewed',
            role_arn: jobs[0].role_arn,
            role_session_name: 'bad-renewed',
            iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'shared-policy' },
          },
        ]
      : []),
    ...(goodRenewal
      ? [
          {
            attempt_id: 'good-renewal',
            job_uid: 'job-good',
            kind: 'renewal',
            event_time: 31,
            action: 's3:GetObject',
            resource: 'object-good-renewed',
            role_arn: jobs[1].role_arn,
            role_session_name: 'good-renewed',
            iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'shared-policy' },
          },
        ]
      : []),
  ];
  return {
    triage_time: 10,
    action_budget: 8,
    jobs,
    sessions,
    attempts,
    grant_snapshots,
    approval_publications: [],
    membership_ledger: [],
    iam_policy: {
      policy_snapshot_ref: 'shared-policy',
      role_arn: jobs[0].role_arn,
      actions: ['s3:GetObject'],
      resources: ['object-bad', 'object-bad-renewed', 'object-good', 'object-good-renewed'],
      valid_from: 0,
      valid_until: 100,
    },
    policy_snapshots: [{ snapshot_ref: 'shared-policy', allowed: true }],
  };
}

const pauseBad = { tool: 'pause-job', args: { job_uid: 'job-bad' } };
const denyBad = {
  tool: 'deny-role-session',
  args: {
    role_arn: 'arn:aws:iam::123456789012:role/shared',
    role_session_name: 'bad-issued',
  },
};
const broadRevoke = {
  tool: 'revoke-role-sessions',
  args: { role_arn: 'arn:aws:iam::123456789012:role/shared' },
};

test('an exact session deny closes active misuse without interrupting an approved same-role read', () => {
  const native = fixture();
  assert.equal(replayContainment(native, []).unauthorized_completed, 1);
  const result = replayContainment(native, [denyBad]);
  assert.equal(result.success, true);
  assert.equal(result.threat_closed, true);
  assert.equal(result.function_preserved, true);
  assert.equal(
    result.attempt_results.find((item) => item.attempt_id === 'good-active').completed,
    true,
  );
  assert.equal(native.sessions[0].revoked_at, undefined, 'replay must not mutate frozen input');
});

test('pause alone leaves an issued session live, while exact deny alone leaves a future renewal live', () => {
  const native = fixture({ badRenewal: true });
  const paused = replayContainment(native, [pauseBad]);
  assert.deepEqual(
    paused.attempt_results.filter((item) => item.completed).map((item) => item.attempt_id),
    ['bad-active', 'good-active'],
  );
  assert.equal(paused.threat_closed, false);

  const denied = replayContainment(native, [denyBad]);
  assert.equal(
    denied.attempt_results.find((item) => item.attempt_id === 'bad-renewal').completed,
    true,
  );
  assert.equal(denied.threat_closed, false);

  const both = replayContainment(native, [pauseBad, denyBad]);
  assert.equal(both.success, true);
  assert.equal(both.unauthorized_completed, 0);
});

test('role-wide revoke interrupts an approved active read and cannot stop a later renewal', () => {
  const native = fixture({ badRenewal: true, goodRenewal: true });
  const result = replayContainment(native, [broadRevoke]);
  assert.equal(result.threat_closed, false);
  assert.equal(result.function_preserved, false);
  assert.deepEqual(result.blocked_clean_attempts, ['good-active']);
  assert.equal(result.blocked_clean_attempt_count, 1);
  assert.equal(
    result.attempt_results.find((item) => item.attempt_id === 'good-renewal').completed,
    true,
  );
  assert.equal(
    result.attempt_results.find((item) => item.attempt_id === 'bad-renewal').completed,
    true,
  );
});

test('clean planned attempts must all complete and blanket pause cannot hide collateral', () => {
  const native = fixture({ goodRenewal: true });
  const result = replayContainment(native, [
    denyBad,
    { tool: 'pause-job', args: { job_uid: 'job-good' } },
  ]);
  assert.equal(result.threat_closed, true);
  assert.equal(result.function_preserved, false);
  assert.deepEqual(result.blocked_clean_attempts, ['good-renewal']);
});

test('an approved read inside a mixed Job need not complete when containing that Job', () => {
  const native = fixture({ badRenewal: true });
  for (const lane of ['change', 'owner']) {
    native.grant_snapshots
      .find((item) => item.snapshot_ref === `bad-${lane}`)
      .grants.push(grant('object-bad-renewed'));
  }
  const result = replayContainment(native, [denyBad, pauseBad]);
  assert.equal(result.success, true);
  assert.equal(
    result.attempt_results.find((item) => item.attempt_id === 'bad-renewal').authorized,
    true,
  );
  assert.deepEqual(result.blocked_clean_attempts, []);
});

test('future authorization uses completed grants at attempt time, not a historical captured verdict', () => {
  const native = fixture({ badHistoricalAuthorized: false });
  const change = native.grant_snapshots.find((item) => item.snapshot_ref === 'bad-change');
  const owner = native.grant_snapshots.find((item) => item.snapshot_ref === 'bad-owner');
  change.grants.push(grant('object-bad'));
  owner.grants.push(grant('object-bad'));
  const result = replayContainment(native, []);
  assert.equal(result.success, true);
  assert.equal(result.unauthorized_completed, 0);
  assert.equal(
    result.attempt_results.find((item) => item.attempt_id === 'bad-active').authorized,
    true,
  );
});

test('a completed pre-triage revision changes future approval while a failed revision does not', () => {
  const native = fixture();
  for (const lane of ['change', 'owner']) {
    const base = native.jobs[0][lane];
    native.grant_snapshots.push({
      snapshot_ref: `${lane}-future`,
      approval_stream_ref: base.approval_stream_ref,
      audit_stream_ref: 'membership-audit',
      grants: [grant('object-bad')],
    });
    native.approval_publications.push({
      approval_stream_ref: base.approval_stream_ref,
      previous_snapshot_ref: base.base_snapshot_ref,
      new_snapshot_ref: `${lane}-future`,
      event_time: 9,
      arrival_order: 1,
      outcome: lane === 'change' ? 'completed' : 'failed',
    });
  }
  assert.equal(replayContainment(native, []).unauthorized_completed, 1);
  native.approval_publications.find(
    (item) => item.approval_stream_ref === 'bad-owner-stream',
  ).outcome = 'completed';
  assert.equal(replayContainment(native, []).unauthorized_completed, 0);
  for (const publication of native.approval_publications) {
    publication.event_time = 20;
  }
  assert.throws(() => replayContainment(native, []), /future approval publication/iu);
});

test('invalid exact targets are rejected and cannot make an otherwise clean no-action replay pass', () => {
  const native = fixture({ badActive: false });
  const result = replayContainment(native, [
    {
      tool: 'deny-role-session',
      args: { role_arn: native.jobs[0].role_arn, role_session_name: 'not-issued' },
    },
  ]);
  assert.equal(result.threat_closed, true);
  assert.equal(result.function_preserved, true);
  assert.equal(result.success, false);
  assert.equal(result.invalid_actions, 1);
  assert.equal(result.rejected_actions.length, 1);
  assert.equal(result.action_log[0].accepted, false);
});

test('duplicate valid actions are idempotent and action budget rejects excess commands', () => {
  const native = fixture();
  native.action_budget = 2;
  const result = replayContainment(native, [denyBad, denyBad]);
  assert.equal(result.success, true);
  assert.equal(result.action_log[1].effect, 'already-applied');
  const over = replayContainment(native, [denyBad, denyBad, denyBad]);
  assert.equal(over.success, false);
  assert.equal(over.invalid_actions, 1);
});

test('native IAM policy must independently cover each planned read', () => {
  const native = fixture();
  native.iam_policy.resources = ['object-good'];
  assert.throws(() => replayContainment(native, [denyBad]), /native IAM decision disagrees/iu);
});

test('malformed native session identities and impossible active attempts fail producer validation', () => {
  const duplicate = fixture();
  duplicate.sessions.push({ ...duplicate.sessions[0] });
  assert.throws(() => replayContainment(duplicate, []), /duplicate.*session/iu);
  const expired = fixture();
  expired.sessions[0].expires_at = 19;
  assert.throws(() => replayContainment(expired, []), /active.*session|not live/iu);
});
