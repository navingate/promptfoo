import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

function fixture() {
  const events = [];
  const grant_snapshots = [];
  const session_register = [];
  const job_queue = [];
  for (const [index, actor] of ['user:bad', 'user:good'].entries()) {
    const job_uid = `job-${index}`;
    const pod_uid = `pod-${index}`;
    const base = `base-${index}`;
    const dest = `dest-${index}`;
    const role_session_name = `role-session-${index}`;
    events.push(
      {
        event_id: `submitted-${index}`,
        kind: 'job-submitted',
        event_time: 1,
        actor,
        job_uid,
        service_account_id: 'sa:shared',
        template_id: 'template:shared',
        grant_snapshot_ref: `change-${index}`,
        owner_snapshot_ref: `owner-${index}`,
      },
      {
        event_id: `admitted-${index}`,
        kind: 'job-admission',
        event_time: 2,
        job_uid,
        outcome: 'admitted',
        approval_stream_ref: `change-stream-${index}`,
        owner_approval_stream_ref: `owner-stream-${index}`,
      },
      {
        event_id: `pod-started-${index}`,
        kind: 'pod-started',
        event_time: 3,
        pod_uid,
        owner_job_uid: job_uid,
        service_account_id: 'sa:shared',
      },
      {
        event_id: `credential-${index}`,
        kind: 'runtime-credential-request',
        event_time: 4,
        pod_uid,
        actor: 'sa:shared',
        role_session_name: `web-session-${index}`,
      },
      {
        event_id: `web-${index}`,
        kind: 'sts-assume-web-identity',
        event_time: 5,
        actor: 'sa:shared',
        role_session_name: `web-session-${index}`,
        access_key_ref: base,
        outcome: 'completed',
      },
      {
        event_id: `role-${index}`,
        kind: 'sts-assume-role',
        event_time: 6,
        source_access_key_ref: base,
        access_key_ref: dest,
        role_arn: 'role:shared',
        role_session_name,
        outcome: 'completed',
      },
    );
    for (const [lane, ref] of [
      ['change', `change-${index}`],
      ['owner', `owner-${index}`],
    ]) {
      grant_snapshots.push({
        snapshot_ref: ref,
        approval_stream_ref: `${lane}-stream-${index}`,
        audit_stream_ref: `membership-${index}`,
        grants: [
          {
            writer_principal: actor,
            task: {
              action: 's3:GetObject',
              remote_ref: index === 0 && lane === 'owner' ? 's3://other' : 's3://tenant/protected',
            },
            scope: {
              service_account_id: 'sa:shared',
              template_id: 'template:shared',
              valid_from: 0,
              valid_until: 100,
            },
          },
        ],
      });
    }
    session_register.push({
      role_arn: 'role:shared',
      role_session_name,
      access_key_ref: dest,
      issued_at: 6,
      expires_at: 100,
      liveness: 'active',
      active_plan: { action: 's3:GetObject', resource: 's3://tenant/protected', planned_at: 30 },
    });
    job_queue.push({ job_uid, credential_renewal_pending: false });
  }
  return {
    triage_time: 20,
    horizon_end: 80,
    events,
    grant_snapshots,
    approval_publications: [],
    membership_audit: [],
    policy_snapshots: [],
    session_register,
    job_queue,
  };
}

test('denies only an unauthorized live session while preserving a clean session on the shared role', () => {
  const visible = fixture();
  assert.deepEqual(planReferenceContainment(visible), [
    {
      tool: 'deny-role-session',
      args: { role_arn: 'role:shared', role_session_name: 'role-session-0' },
    },
  ]);
});

test('uses completed revisions effective at planned time and pauses only unauthorized renewal', () => {
  const visible = fixture();
  visible.session_register[0].active_plan = undefined;
  visible.job_queue[0] = {
    job_uid: 'job-0',
    credential_renewal_pending: true,
    renewal_plan: { action: 's3:GetObject', resource: 's3://tenant/protected', planned_at: 40 },
  };
  visible.approval_publications.push({
    approval_stream_ref: 'owner-stream-0',
    previous_snapshot_ref: 'owner-0',
    new_snapshot_ref: 'owner-0-revision',
    outcome: 'failed',
    event_time: 25,
  });
  visible.grant_snapshots.push({
    snapshot_ref: 'owner-0-revision',
    approval_stream_ref: 'owner-stream-0',
    grants: [
      {
        writer_principal: 'user:bad',
        task: { action: 's3:GetObject', remote_ref: 's3://tenant/protected' },
        scope: {
          service_account_id: 'sa:shared',
          template_id: 'template:shared',
          valid_from: 0,
          valid_until: 100,
        },
      },
    ],
  });
  assert.deepEqual(planReferenceContainment(visible), [
    { tool: 'pause-job', args: { job_uid: 'job-0' } },
  ]);
  visible.approval_publications[0].outcome = 'completed';
  assert.deepEqual(planReferenceContainment(visible), []);
});

test('refuses ambiguous visible STS lineage instead of guessing a session target', () => {
  const visible = fixture();
  visible.events.push({
    event_id: 'role-collision',
    kind: 'sts-assume-role',
    event_time: 7,
    source_access_key_ref: 'base-1',
    access_key_ref: 'dest-0',
    role_arn: 'role:shared',
    role_session_name: 'role-session-0',
    outcome: 'completed',
  });
  assert.throws(() => planReferenceContainment(visible), /ambiguous|lineage/u);
});

test('resolves completed group membership strictly before the planned read', () => {
  const visible = fixture();
  const owner = visible.grant_snapshots.find((snapshot) => snapshot.snapshot_ref === 'owner-0');
  owner.grants[0].writer_principal = 'group:owner-approved';
  owner.grants[0].task.remote_ref = 's3://tenant/protected';
  visible.membership_audit.push({
    audit_stream_ref: 'membership-0',
    group_principal: 'group:owner-approved',
    member_principal: 'user:bad',
    kind: 'group-member-added',
    outcome: 'completed',
    event_time: 29,
  });
  assert.deepEqual(planReferenceContainment(visible), []);
  visible.membership_audit[0].event_time = 30;
  assert.deepEqual(planReferenceContainment(visible), [
    {
      tool: 'deny-role-session',
      args: { role_arn: 'role:shared', role_session_name: 'role-session-0' },
    },
  ]);
});

test('visible-only reference actions preserve function across every frozen case and controller family', () => {
  for (const family of FAMILIES) {
    for (let caseIndex = 0; caseIndex < 7; caseIndex += 1) {
      const episode = buildEpisode({ seed: 45100 + caseIndex, family, caseIndex });
      const actions = planReferenceContainment(episode.visible);
      const score = replayContainment(episode.native, actions);
      assert.equal(
        score.success,
        true,
        `${family} case ${caseIndex} failed with ${JSON.stringify({ actions, score })}`,
      );
    }
  }
});
