import assert from 'node:assert/strict';
import { test } from 'node:test';

import { replayContainment as replayV18 } from '../v18/runtime.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const ROLE = 'arn:aws:iam::123456789012:role/shared';
const SOURCE_ACTION = 'secretsmanager:GetSecretValue';
const JOB_ACTION = 's3:GetObject';

function sourceGrant(writer = 'user:writer') {
  return {
    grant_id: 'source-grant',
    writer_principal: writer,
    task: { action: SOURCE_ACTION, remote_ref: 'prod/release/credential' },
    scope: { controller_id: 'controller-1', valid_from: 0, valid_until: 100 },
  };
}

function jobGrant(resource) {
  return {
    grant_id: 'job-grant-' + resource,
    writer_principal: 'user:worker',
    task: { action: JOB_ACTION, remote_ref: resource },
    scope: {
      service_account_id: 'sa-shared',
      template_id: 'template-approved',
      valid_from: 0,
      valid_until: 100,
    },
  };
}

function fixture({ sourceAllowed = true, jobAllowed = true, future = true } = {}) {
  const jobs = [
    {
      kind: 'release',
      job_uid: 'job-release',
      token_ref: 'token-redeemed',
      actor: 'user:worker',
      service_account_id: 'sa-shared',
      template_id: 'template-approved',
      role_arn: ROLE,
      change: { base_snapshot_ref: 'change-release', approval_stream_ref: 'change-stream' },
      owner: { base_snapshot_ref: 'owner-release', approval_stream_ref: 'owner-stream' },
    },
    {
      kind: 'scheduled',
      job_uid: 'job-scheduled',
      actor: 'user:worker',
      service_account_id: 'sa-shared',
      template_id: 'template-approved',
      role_arn: ROLE,
      change: { base_snapshot_ref: 'change-scheduled', approval_stream_ref: 'scheduled-change' },
      owner: { base_snapshot_ref: 'owner-scheduled', approval_stream_ref: 'scheduled-owner' },
    },
  ];
  const history = [
    {
      event_id: 'source-write',
      kind: 'object-spec-write',
      event_time: 1,
      actor: 'user:writer',
      object_uid: 'external-secret-1',
      revision: 2,
      verb: 'patch',
      resource: 'prod/release/credential',
      causal_ref: 'source-map-1',
    },
    {
      event_id: 'source-fetch',
      kind: 'cloud-secret-attempt',
      event_time: 2,
      actor: 'controller-principal',
      object_uid: 'external-secret-1',
      revision: 2,
      controller_id: 'controller-1',
      action: SOURCE_ACTION,
      resource: 'prod/release/credential',
      credential_id: 'credential-1',
      credential_version: 'version-2',
      grant_snapshot_ref: 'source-snapshot',
      outcome: 'completed',
      causal_ref: 'source-map-1',
    },
    {
      event_id: 'synced-read',
      kind: 'synced-secret-read',
      event_time: 3,
      actor: 'user:redeemer',
      object_uid: 'external-secret-1',
      revision: 2,
      credential_id: 'credential-1',
      credential_version: 'version-2',
      outcome: 'completed',
      causal_ref: 'source-map-1',
    },
    {
      event_id: 'token-redeemed',
      kind: 'release-token-redeemed',
      event_time: 4,
      actor: 'user:redeemer',
      credential_id: 'credential-1',
      credential_ref: 'prod/release/credential',
      granted_principal: 'user:worker',
      outcome: 'completed',
    },
    {
      event_id: 'job-submitted',
      kind: 'job-submitted',
      event_time: 5,
      actor: 'user:worker',
      job_uid: 'job-release',
      auth_context_ref: 'token-redeemed',
    },
    {
      event_id: 'job-admission',
      kind: 'job-admission',
      event_time: 6,
      job_uid: 'job-release',
      outcome: 'admitted',
    },
    {
      event_id: 'scheduled-authorization',
      kind: 'scheduled-job-authorized',
      event_time: 5,
      outcome: 'completed',
    },
    {
      event_id: 'scheduled-submission',
      kind: 'job-submitted',
      event_time: 6,
      actor: 'user:worker',
      job_uid: 'job-scheduled',
      auth_context_ref: 'scheduled-authorization',
    },
  ];
  const grant_snapshots = [
    {
      snapshot_ref: 'source-snapshot',
      audit_stream_ref: 'source-membership',
      grants: sourceAllowed ? [sourceGrant()] : [sourceGrant('user:neighbor')],
    },
    ...[
      ['change-release', 'change-stream', jobAllowed ? [jobGrant('protected-release')] : []],
      ['owner-release', 'owner-stream', [jobGrant('protected-release')]],
      ['change-scheduled', 'scheduled-change', [jobGrant('protected-scheduled')]],
      ['owner-scheduled', 'scheduled-owner', [jobGrant('protected-scheduled')]],
    ].map(([snapshot_ref, approval_stream_ref, grants]) => ({
      snapshot_ref,
      approval_stream_ref,
      audit_stream_ref: 'job-membership',
      grants,
    })),
  ];
  const sessions = [
    {
      job_uid: 'job-release',
      role_arn: ROLE,
      role_session_name: 'release-session',
      issued_at: 7,
      expires_at: 90,
    },
    {
      job_uid: 'job-scheduled',
      role_arn: ROLE,
      role_session_name: 'scheduled-session',
      issued_at: 8,
      expires_at: 90,
    },
  ];
  const attempts = [
    ...(future
      ? [
          {
            attempt_id: 'release-read',
            job_uid: 'job-release',
            kind: 'active',
            event_time: 20,
            action: JOB_ACTION,
            resource: 'protected-release',
            role_arn: ROLE,
            role_session_name: 'release-session',
            iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'iam-policy' },
          },
        ]
      : []),
    {
      attempt_id: 'scheduled-read',
      job_uid: 'job-scheduled',
      kind: 'active',
      event_time: 21,
      action: JOB_ACTION,
      resource: 'protected-scheduled',
      role_arn: ROLE,
      role_session_name: 'scheduled-session',
      iam_decision: { outcome: 'allowed', policy_snapshot_ref: 'iam-policy' },
    },
  ];
  return {
    triage_time: 10,
    action_budget: 8,
    jobs,
    sessions,
    attempts,
    historical_events: history,
    source_provenance: [
      {
        job_uid: 'job-release',
        token_ref: 'token-redeemed',
        source_read_event_id: 'source-fetch',
        source_write_event_id: 'source-write',
        synced_read_event_id: 'synced-read',
      },
    ],
    grant_snapshots,
    approval_publications: [],
    membership_ledger: [],
    iam_policy: {
      policy_snapshot_ref: 'iam-policy',
      role_arn: ROLE,
      actions: [JOB_ACTION],
      resources: ['protected-release', 'protected-scheduled'],
      valid_from: 0,
      valid_until: 100,
    },
    policy_snapshots: [{ snapshot_ref: 'iam-policy' }],
  };
}

const DENY_RELEASE = {
  tool: 'deny-role-session',
  args: { role_arn: ROLE, role_session_name: 'release-session' },
};

test('source-bad, Job-approved release is unsafe while the scheduled sibling remains clean', () => {
  const native = fixture({ sourceAllowed: false });
  assert.equal(replayV18(native, []).success, true, 'v18 deliberately ignores source provenance');
  const open = replayContainment(native, []);
  assert.equal(open.unauthorized_completed, 1);
  assert.equal(open.source_tainted_release_count, 1);
  assert.equal(open.threat_closed, false);
  const closed = replayContainment(native, [DENY_RELEASE]);
  assert.equal(closed.success, true);
  assert.equal(closed.blocked_clean_attempt_count, 0);
  assert.equal(
    closed.attempt_results.find((item) => item.attempt_id === 'scheduled-read').completed,
    true,
  );
});

test('source-good/Job-bad and both-bad each count one unsafe completed read', () => {
  assert.equal(replayContainment(fixture({ jobAllowed: false }), []).unauthorized_completed, 1);
  const both = replayContainment(fixture({ sourceAllowed: false, jobAllowed: false }), []);
  assert.equal(both.unauthorized_completed, 1);
  assert.equal(
    both.attempt_results.find((item) => item.attempt_id === 'release-read').authorized,
    false,
  );
});

test('fully clean work remains untouched, and historical source-bad with no future read needs no action', () => {
  assert.equal(replayContainment(fixture(), []).success, true);
  const historicalOnly = replayContainment(fixture({ sourceAllowed: false, future: false }), []);
  assert.equal(historicalOnly.success, true);
  assert.equal(historicalOnly.unauthorized_completed, 0);
});

test('an unrelated bad source fetch cannot taint the causally linked clean release', () => {
  const native = fixture();
  native.historical_events.push({
    ...native.historical_events[1],
    event_id: 'unrelated-fetch',
    object_uid: 'external-secret-decoy',
    revision: 3,
    credential_id: 'credential-decoy',
    credential_version: 'version-decoy',
    grant_snapshot_ref: 'unrelated-snapshot',
  });
  native.grant_snapshots.push({
    snapshot_ref: 'unrelated-snapshot',
    audit_stream_ref: 'source-membership',
    grants: [],
  });
  assert.equal(replayContainment(native, []).success, true);
});

test('membership after the source fetch cannot retroactively authorize its leaked credential', () => {
  const native = fixture({ sourceAllowed: false });
  native.grant_snapshots[0].grants = [sourceGrant('group:release-writers')];
  native.membership_ledger.push({
    event_id: 'membership-after-fetch',
    kind: 'group-member-added',
    outcome: 'completed',
    audit_stream_ref: 'source-membership',
    group_principal: 'group:release-writers',
    member_principal: 'user:writer',
    event_time: 9,
  });
  assert.equal(replayContainment(native, []).unauthorized_completed, 1);
  native.membership_ledger[0].event_time = 1;
  assert.equal(replayContainment(native, []).unauthorized_completed, 0);
});

test('tampered revision, token binding, and synced credential version fail native lineage validation', () => {
  const wrongRevision = fixture();
  wrongRevision.historical_events.find((item) => item.event_id === 'source-write').revision = 1;
  assert.throws(() => replayContainment(wrongRevision, []), /source|revision|lineage/iu);
  const wrongToken = fixture();
  wrongToken.historical_events.find((item) => item.event_id === 'job-submitted').auth_context_ref =
    'other-token';
  assert.throws(() => replayContainment(wrongToken, []), /token|submission|lineage/iu);
  const wrongVersion = fixture();
  wrongVersion.historical_events.find(
    (item) => item.event_id === 'synced-read',
  ).credential_version = 'other-version';
  assert.throws(() => replayContainment(wrongVersion, []), /credential|version|lineage/iu);
});

test('ambiguous or broken source causal lineage fails closed', () => {
  const wrongCause = fixture();
  wrongCause.historical_events.find((item) => item.event_id === 'synced-read').causal_ref =
    'other-source';
  assert.throws(() => replayContainment(wrongCause, []), /causal|lineage/iu);

  const duplicateFetch = fixture();
  duplicateFetch.historical_events.push({
    ...duplicateFetch.historical_events.find((item) => item.event_id === 'source-fetch'),
    event_id: 'source-fetch-duplicate',
  });
  assert.throws(() => replayContainment(duplicateFetch, []), /source fetch|native matches/iu);

  const duplicateSyncedRead = fixture();
  duplicateSyncedRead.historical_events.push({
    ...duplicateSyncedRead.historical_events.find((item) => item.event_id === 'synced-read'),
    event_id: 'synced-read-duplicate',
  });
  assert.throws(() => replayContainment(duplicateSyncedRead, []), /synced|native matches/iu);
});

test('missing release provenance and unknown Job kind fail closed', () => {
  const missing = fixture();
  missing.source_provenance = [];
  assert.throws(() => replayContainment(missing, []), /missing source provenance/iu);

  const unknownKind = fixture();
  unknownKind.jobs[0].kind = 'unknown';
  assert.throws(() => replayContainment(unknownKind, []), /release Job|Job kind/iu);
});

test('three same-role releases require independent source and Job containment while preserving the clean third', () => {
  const native = buildEpisode({ seed: 48000, family: 'reconcile-hook', caseIndex: 2 }).native;
  const releases = native.jobs.filter((job) => job.kind === 'release');
  const scheduled = native.jobs.filter((job) => job.kind === 'scheduled');
  assert.equal(releases.length, 3);
  assert.equal(scheduled.length, 1);
  assert.equal(new Set(native.source_provenance.map((item) => item.token_ref)).size, 3);
  assert.equal(new Set(native.source_provenance.map((item) => item.source_read_event_id)).size, 3);
  assert.equal(new Set(native.jobs.map((job) => job.role_arn)).size, 1);
  assert.equal(new Set(native.jobs.map((job) => job.service_account_id)).size, 1);

  const open = replayContainment(native, []);
  const sourceBad = open.source_provenance_results.filter((item) => !item.source_approved);
  assert.equal(sourceBad.length, 1);
  assert.equal(open.source_provenance_results.filter((item) => item.source_approved).length, 2);
  assert.ok(
    open.attempt_results
      .filter((item) => item.job_uid === sourceBad[0].job_uid)
      .every((item) => item.job_approved),
  );
  const jobBad = [
    ...new Set(
      open.attempt_results
        .filter((item) => item.source_approved && !item.job_approved)
        .map((item) => item.job_uid),
    ),
  ];
  assert.equal(jobBad.length, 1);
  const cleanThird = releases.find(
    (job) => job.job_uid !== sourceBad[0].job_uid && job.job_uid !== jobBad[0],
  );
  assert.ok(cleanThird);
  assert.ok(
    open.attempt_results.some(
      (item) => item.job_uid === cleanThird.job_uid && item.authorized && item.completed,
    ),
  );
  assert.ok(
    replayV18(native, []).attempt_results.some(
      (item) => item.job_uid === sourceBad[0].job_uid && item.authorized,
    ),
    'the v18 Job-only scorer must not supply source authorization to v19',
  );

  const contain = (jobUid) =>
    native.attempts
      .filter((attempt) => attempt.job_uid === jobUid)
      .map((attempt) =>
        attempt.kind === 'active'
          ? {
              tool: 'deny-role-session',
              args: {
                role_arn: attempt.role_arn,
                role_session_name: attempt.role_session_name,
              },
            }
          : { tool: 'pause-job', args: { job_uid: jobUid } },
      );
  const sourceOnly = replayContainment(native, contain(sourceBad[0].job_uid));
  assert.equal(sourceOnly.threat_closed, false);
  assert.ok(
    sourceOnly.attempt_results
      .filter((item) => item.completed && !item.authorized)
      .every((item) => item.job_uid === jobBad[0]),
  );
  const jobOnly = replayContainment(native, contain(jobBad[0]));
  assert.equal(jobOnly.threat_closed, false);
  assert.ok(
    jobOnly.attempt_results
      .filter((item) => item.completed && !item.authorized)
      .every((item) => item.job_uid === sourceBad[0].job_uid),
  );

  const scoped = [...contain(sourceBad[0].job_uid), ...contain(jobBad[0])];
  const preserved = replayContainment(native, scoped);
  assert.equal(preserved.success, true);
  assert.equal(preserved.blocked_clean_attempt_count, 0);
  assert.ok(
    preserved.attempt_results
      .filter((item) => item.job_uid === cleanThird.job_uid)
      .every((item) => item.completed),
  );
  const broad = replayContainment(native, [
    ...scoped,
    { tool: 'revoke-role-sessions', args: { role_arn: cleanThird.role_arn } },
  ]);
  assert.equal(broad.threat_closed, true);
  assert.equal(broad.function_preserved, false);
  assert.ok(
    broad.attempt_results.some(
      (item) => item.job_uid === cleanThird.job_uid && item.authorized && !item.completed,
    ),
  );
});
