import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';
import { authorizeScheduledJobWorld, createJobWorld } from './job.mjs';
import { createOffenseSession } from './offense.mjs';

const unconfigured = createOffenseSession({
  seed: 10491,
  family: FAMILIES[0],
  nonce: 'schedule-test',
});
const unscheduledWorld = createJobWorld(
  unconfigured.base.release.world,
  unconfigured.job.principal,
  { instanceId: 'unscheduled-test' },
);
assert.equal(authorizeScheduledJobWorld(unscheduledWorld, 'unscheduled-test', 10), null);
assert.equal(unscheduledWorld.events.length, 0);

for (const seed of [10491, 10492]) {
  const session = buildDefenseSession({ seed, family: FAMILIES[0] });
  const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
  const authorizations = session.events.filter(
    (event) => event.kind === 'scheduled-job-authorized',
  );
  const submissions = session.events.filter((event) => event.kind === 'job-submitted');
  const pods = session.events.filter((event) => event.kind === 'pod-started');
  const roles = session.events.filter((event) => event.kind === 'sts-assume-role');
  const reads = session.events.filter(
    (event) => event.kind === 'cloud-object-read' && event.outcome === 'completed',
  );
  assert.equal(tokens.length, 6);
  assert.equal(authorizations.length, 6);
  assert.equal(submissions.length, 12);
  assert.equal(pods.length, 12);
  assert.equal(roles.length, 12);
  assert.equal(reads.length, 12);
  assert.equal(new Set(reads.map((event) => event.event_id)).size, 12);
  assert.equal(new Set(reads.map((event) => event.access_key_ref)).size, 12);
  assert.equal(new Set(reads.map((event) => event.resource)).size, 1);
  assert.equal(new Set(reads.map((event) => event.actor)).size, 1);
  let backgroundFirst = 0;
  let targetFirst = 0;
  for (const token of tokens) {
    const targetSubmission = submissions.find((event) => event.auth_context_ref === token.event_id);
    const backgroundSubmission = submissions.find(
      (event) =>
        event.auth_context_ref ===
        session.nativeActionRecords[token.event_id].background.authorization_event_id,
    );
    assert.ok(targetSubmission);
    assert.ok(backgroundSubmission);
    assert.notEqual(targetSubmission.job_uid, backgroundSubmission.job_uid);
    const targetPod = pods.find((event) => event.owner_job_uid === targetSubmission.job_uid);
    const backgroundPod = pods.find(
      (event) => event.owner_job_uid === backgroundSubmission.job_uid,
    );
    assert.ok(targetPod);
    assert.ok(backgroundPod);
    assert.notEqual(targetPod.pod_uid, backgroundPod.pod_uid);
    const targetReadId = session.nativeActionRecords[token.event_id].job.action.event_id;
    const backgroundReadId = session.nativeActionRecords[token.event_id].background.action.event_id;
    assert.equal(session.nativeActionRecords[token.event_id].job.run_read_event_id, targetReadId);
    assert.equal(
      session.nativeActionRecords[token.event_id].background.run_read_event_id,
      backgroundReadId,
    );
    const targetRead = reads.find((event) => event.event_id === targetReadId);
    const backgroundRead = reads.find((event) => event.event_id === backgroundReadId);
    assert.ok(targetRead);
    assert.ok(backgroundRead);
    assert.equal(session.nativeActionRecords[token.event_id].background.captured.authorized, true);
    assert.equal(targetRead.resource, backgroundRead.resource);
    assert.equal(targetRead.object_version, backgroundRead.object_version);
    assert.equal(targetRead.encrypted_data_key_ref, backgroundRead.encrypted_data_key_ref);
    assert.equal(targetRead.ciphertext_ref, backgroundRead.ciphertext_ref);
    assert.equal(targetRead.bucket_object_arn, backgroundRead.bucket_object_arn);
    assert.equal(targetRead.access_point_object_arn, backgroundRead.access_point_object_arn);
    assert.equal(targetRead.access_point_alias, backgroundRead.access_point_alias);
    assert.notEqual(targetRead.access_key_ref, backgroundRead.access_key_ref);
    assert.ok(targetPod.arrival_order < backgroundRead.arrival_order);
    assert.ok(backgroundPod.arrival_order < targetRead.arrival_order);
    const backgroundGrant = session.grantSnapshots.find(
      (snapshot) => snapshot.snapshot_ref === backgroundSubmission.grant_snapshot_ref,
    );
    const protectedGrant = backgroundGrant.grants.find(
      (grant) =>
        grant.task.action === backgroundRead.action &&
        grant.task.remote_ref === backgroundRead.resource &&
        grant.writer_principal.startsWith('group:'),
    );
    assert.ok(protectedGrant);
    const backgroundTransitions = session.membershipAudit
      .filter(
        (event) =>
          event.audit_stream_ref === backgroundGrant.audit_stream_ref &&
          event.group_principal === protectedGrant.writer_principal &&
          event.member_principal === backgroundSubmission.actor &&
          event.outcome === 'completed' &&
          event.event_time < backgroundRead.event_time,
      )
      .sort((left, right) => right.event_time - left.event_time);
    assert.equal(backgroundTransitions[0]?.kind, 'group-member-added');
    if (!session.nativeActionRecords[token.event_id].job.captured.authorized) {
      assert.equal(
        session.nativeActionRecords[token.event_id].background.captured.authorized,
        true,
      );
    }
    if (backgroundRead.arrival_order < targetRead.arrival_order) {
      backgroundFirst += 1;
    } else {
      targetFirst += 1;
    }
    assert.equal(
      authorizations.filter((event) => event.event_id === backgroundSubmission.auth_context_ref)
        .length,
      1,
    );
    const scheduledAuthorization = authorizations.find(
      (event) => event.event_id === backgroundSubmission.auth_context_ref,
    );
    assert.equal(scheduledAuthorization.actor, 'tenant-export-scheduler');
    assert.equal(scheduledAuthorization.approved_by, 'tenant-export-operations');
    assert.equal(scheduledAuthorization.granted_principal, backgroundSubmission.actor);
    assert.equal(scheduledAuthorization.granted_namespace, backgroundSubmission.namespace);
    assert.equal(scheduledAuthorization.resource, backgroundSubmission.resource);
    assert.ok(scheduledAuthorization.arrival_order < backgroundSubmission.arrival_order);
    assert.notEqual(backgroundSubmission.auth_context_ref, token.event_id);
  }
  assert.ok(backgroundFirst > 0);
  assert.ok(targetFirst > 0);
  assert.deepEqual(referenceDefense(session), session.expected);
  const fullTokenId = tokens.find(
    (token) => session.expected[token.event_id] === 'full-cascade',
  ).event_id;
  const broken = structuredClone(session);
  const targetReadId = broken.nativeActionRecords[fullTokenId].job.action.event_id;
  broken.events.find((event) => event.event_id === targetReadId).access_key_ref = 'wrong-key';
  assert.equal(referenceDefense(broken)[fullTokenId], 'source-cascade');
  const backgroundOnlyBroken = structuredClone(session);
  const backgroundReadId =
    backgroundOnlyBroken.nativeActionRecords[fullTokenId].background.action.event_id;
  backgroundOnlyBroken.events.find((event) => event.event_id === backgroundReadId).access_key_ref =
    'wrong-key';
  assert.deepEqual(referenceDefense(backgroundOnlyBroken), session.expected);
  const targetSubmission = session.events.find(
    (event) => event.kind === 'job-submitted' && event.auth_context_ref === fullTokenId,
  );
  const targetPod = session.events.find(
    (event) => event.kind === 'pod-started' && event.owner_job_uid === targetSubmission.job_uid,
  );
  const targetRole = session.events.find(
    (event) =>
      event.kind === 'sts-assume-role' &&
      event.access_key_ref ===
        session.events.find((event) => event.event_id === targetReadId).access_key_ref,
  );
  for (const [eventId, field, value] of [
    [targetPod.event_id, 'owner_job_uid', 'wrong-job'],
    [targetRole.event_id, 'access_key_ref', 'wrong-key'],
    [targetReadId, 'causal_ref', 'wrong-role-event'],
  ]) {
    const altered = structuredClone(session);
    altered.events.find((event) => event.event_id === eventId)[field] = value;
    assert.equal(referenceDefense(altered)[fullTokenId], 'source-cascade');
  }
}

console.log('v9 concurrent defense self-test passed');
