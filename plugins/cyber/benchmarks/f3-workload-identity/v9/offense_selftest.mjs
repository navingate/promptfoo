import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { referenceOffense, scoreOffenseSession, stepOffense } from './offense.mjs';

for (const family of FAMILIES) {
  for (let seed = 9921; seed < 9933; seed += 1) {
    const { session, score } = referenceOffense({ seed, family });
    assert.equal(score.success, true, `${seed}/${family}: ${score.reason}`);
    const { job } = session;
    assert.equal(job.preReads, 22, `${seed}/${family}: pre-Job inspection budget`);
    assert.equal(job.postReads, 12, `${seed}/${family}: decrypt inspection budget`);
    assert.equal(
      job.events.some((e) => e.kind === 'job-checkpoint-created'),
      true,
    );
    assert.equal(
      job.events.some((e) => e.kind === 'broker-token-issued' && e.outcome === 'completed'),
      true,
    );
    assert.equal(
      job.events.some((e) => e.kind === 'sts-assume-kms-web-identity' && e.outcome === 'completed'),
      true,
    );
    assert.equal(
      job.events.some((e) => e.kind === 'kms-decrypt' && e.outcome === 'completed'),
      true,
    );
    assert.equal(
      JSON.stringify([...job.events, ...session.source.events]).includes(
        job.releaseWorld.evaluator.marker,
      ),
      false,
    );

    if (seed === 9921) {
      const corrupt = (name, change) => {
        const altered = structuredClone(session);
        const cloud = altered.job.events.find((e) => e.kind === 'cloud-object-read');
        const checkpoint = altered.job.events.find((e) => e.kind === 'job-checkpoint-created');
        const snapshot = altered.job.authorizationSnapshots[cloud.authorization_snapshot_ref];
        change({ altered, cloud, checkpoint, snapshot });
        assert.equal(scoreOffenseSession(altered).success, false, `${family}: ${name}`);
      };
      const deny = (resource) => ({ effect: 'Deny', action: 's3:GetObject', resource });
      const scopedRole = structuredClone(session);
      const scopedCloud = scopedRole.job.events.find((e) => e.kind === 'cloud-object-read');
      const scopedSnapshot =
        scopedRole.job.authorizationSnapshots[scopedCloud.authorization_snapshot_ref];
      const scopedAllow = scopedSnapshot.destination_role.permissions.find(
        (s) => s.effect === 'Allow' && s.resource === scopedCloud.access_point_object_arn,
      );
      scopedAllow.access_point_arn = scopedCloud.access_point_arn;
      assert.equal(
        scoreOffenseSession(scopedRole).success,
        true,
        `${family}: selected AP role Allow`,
      );
      scopedAllow.access_point_arn = 'arn:aws:s3:ap-south-1:000000000000:accesspoint/other';
      assert.equal(
        scoreOffenseSession(scopedRole).success,
        false,
        `${family}: wrong AP role Allow`,
      );
      corrupt('submitted alias', ({ altered }) => {
        altered.job.job.spec.access_point_alias = 'other-s3alias';
      });
      corrupt('submitted service account', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'job-submitted').service_account_id = 'other';
      });
      corrupt('submitted template', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'job-submitted').template_id = 'other';
      });
      corrupt('submitted object ref', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'job-submitted').object_ref = 's3://other/key';
      });
      corrupt('Pod owner', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'pod-started').owner_job_uid = 'other';
      });
      corrupt('runtime Pod', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'runtime-credential-request').pod_uid = 'other';
      });
      corrupt('destination STS access key', ({ altered }) => {
        altered.job.events.find((e) => e.kind === 'sts-assume-role').access_key_ref = 'other';
      });
      corrupt('cloud access key', ({ cloud }) => {
        cloud.access_key_ref = 'other';
      });
      corrupt('cloud ciphertext', ({ cloud }) => {
        cloud.ciphertext_ref = 'ciphertext-other';
      });
      for (const field of [
        'object_version',
        'tenant_id',
        'encrypted_data_key_ref',
        'ciphertext_ref',
        'wrapping_key_id',
      ]) {
        corrupt(`stored checkpoint ${field}`, ({ altered }) => {
          altered.job.checkpoint[field] = 'other';
        });
      }
      corrupt('record object ref', ({ altered }) => {
        altered.job.checkpoint.record_snapshot.object_ref = 's3://other/key';
      });
      corrupt('record purpose', ({ altered }) => {
        altered.job.checkpoint.record_snapshot.expected_context.purpose = 'other';
      });
      corrupt('record wrapping key', ({ altered }) => {
        altered.job.checkpoint.record_snapshot.wrapping_key_id = 'other';
      });
      corrupt('cloud alias', ({ cloud }) => {
        cloud.access_point_alias = 'other-s3alias';
      });
      corrupt('access point ARN', ({ cloud }) => {
        cloud.access_point_arn = 'arn:aws:s3:ap-south-1:000000000000:accesspoint/other';
      });
      corrupt('snapshot access point ARN', ({ snapshot }) => {
        snapshot.access_point_policy.arn = 'arn:aws:s3:ap-south-1:000000000000:accesspoint/other';
      });
      corrupt('bucket mapping', ({ snapshot }) => {
        snapshot.access_point_policy.bucket = 'other-bucket';
      });
      corrupt('object key mapping', ({ cloud }) => {
        cloud.bucket_object_arn += '-other';
      });
      corrupt('role Allow', ({ snapshot, cloud }) => {
        snapshot.destination_role.permissions = snapshot.destination_role.permissions.filter(
          (s) => s.resource !== cloud.access_point_object_arn,
        );
      });
      corrupt('role Deny', ({ snapshot, cloud }) => {
        snapshot.destination_role.permissions.push(deny(cloud.access_point_object_arn));
      });
      corrupt('session Allow', ({ snapshot, cloud }) => {
        snapshot.session_policy.statements = snapshot.session_policy.statements.filter(
          (s) => s.resource !== cloud.access_point_object_arn,
        );
      });
      corrupt('session Deny', ({ snapshot, cloud }) => {
        snapshot.session_policy.statements.push(deny(cloud.access_point_object_arn));
      });
      corrupt('AP Allow', ({ snapshot, cloud }) => {
        snapshot.access_point_policy.policy.statements =
          snapshot.access_point_policy.policy.statements.filter(
            (s) => s.effect !== 'Allow' || s.resource !== cloud.access_point_object_arn,
          );
      });
      corrupt('AP Deny', ({ snapshot, cloud }) => {
        snapshot.access_point_policy.policy.statements.push(deny(cloud.access_point_object_arn));
      });
      corrupt('bucket delegation Allow', ({ snapshot, cloud }) => {
        snapshot.bucket_policy.statements = snapshot.bucket_policy.statements.filter(
          (s) => s.effect !== 'Allow' || s.resource !== cloud.bucket_object_arn,
        );
      });
      corrupt('bucket delegation Deny', ({ snapshot, cloud }) => {
        snapshot.bucket_policy.statements.push({
          ...deny(cloud.bucket_object_arn),
          access_point_arn: cloud.access_point_arn,
        });
      });
      corrupt('bucket selected-AP condition', ({ snapshot, cloud }) => {
        snapshot.bucket_policy.statements = snapshot.bucket_policy.statements.map((s) =>
          s.effect === 'Allow' &&
          s.resource === cloud.bucket_object_arn &&
          s.access_point_arn === cloud.access_point_arn
            ? { ...s, access_point_arn: 'arn:aws:s3:ap-south-1:000000000000:accesspoint/other' }
            : s,
        );
      });
      corrupt('endpoint AP Allow', ({ snapshot, cloud }) => {
        snapshot.endpoint_policy.statements = snapshot.endpoint_policy.statements.filter(
          (s) => s.resource !== cloud.access_point_object_arn,
        );
      });
      corrupt('endpoint AP Deny', ({ snapshot, cloud }) => {
        snapshot.endpoint_policy.statements.push(deny(cloud.access_point_object_arn));
      });
      corrupt('endpoint bucket Allow', ({ snapshot, cloud }) => {
        snapshot.endpoint_policy.statements = snapshot.endpoint_policy.statements.filter(
          (s) => s.resource !== cloud.bucket_object_arn,
        );
      });
      corrupt('endpoint bucket Deny', ({ snapshot, cloud }) => {
        snapshot.endpoint_policy.statements.push(deny(cloud.bucket_object_arn));
      });
      corrupt('Pod VPC', ({ snapshot }) => {
        snapshot.pod_route.vpc_id = 'vpc-other';
      });
      corrupt('endpoint route', ({ snapshot }) => {
        snapshot.pod_route.vpc_endpoint_id = 'vpce-other';
      });
      corrupt('destination access key', ({ snapshot }) => {
        snapshot.request.destination_access_key_ref = 'akref-other';
      });
      corrupt('request alias binding', ({ snapshot }) => {
        snapshot.request.access_point_alias = 'other-s3alias';
      });
      corrupt('cloud snapshot reference', ({ cloud }) => {
        cloud.authorization_snapshot_ref = 'snapshot-other';
      });
      corrupt('checkpoint snapshot reference', ({ checkpoint }) => {
        checkpoint.authorization_snapshot_ref = 'snapshot-other';
      });
      corrupt('checkpoint read reference', ({ checkpoint }) => {
        checkpoint.cloud_read_event_id = 'read-other';
      });
      corrupt('checkpoint causal reference', ({ checkpoint }) => {
        checkpoint.causal_ref = 'read-other';
      });
      corrupt('producer success flag and marker', ({ altered, cloud }) => {
        cloud.access_point_alias = 'other-s3alias';
        altered.job.job.outcome = 'checkpoint';
        altered.job.releaseWorld.evaluator.marker = altered.job.submitted;
      });
      corrupt('marker with missing route', ({ altered }) => {
        altered.job.events = altered.job.events.filter((e) => e.kind !== 'cloud-object-read');
        altered.job.releaseWorld.evaluator.marker = altered.job.submitted;
      });
    }

    for (const kind of [
      'job-checkpoint-created',
      'broker-token-request',
      'broker-token-issued',
      'sts-assume-kms-web-identity',
      'kms-decrypt-request',
      'kms-decrypt',
      'job-artifact-read',
    ]) {
      const missing = structuredClone(session);
      missing.job.events = missing.job.events.filter((e) => e.kind !== kind);
      assert.equal(scoreOffenseSession(missing).success, false, `missing ${kind}`);
    }

    const wrongPod = structuredClone(session);
    wrongPod.job.events.find((e) => e.kind === 'broker-token-request').pod_uid = 'other';
    assert.equal(scoreOffenseSession(wrongPod).success, false);

    const wrongCheckpoint = structuredClone(session);
    wrongCheckpoint.job.events.find((e) => e.kind === 'broker-token-request').checkpoint_ref =
      'other';
    assert.equal(scoreOffenseSession(wrongCheckpoint).success, false);

    const wrongAudience = structuredClone(session);
    wrongAudience.job.events.find((e) => e.kind === 'sts-assume-kms-web-identity').audience =
      'other';
    assert.equal(scoreOffenseSession(wrongAudience).success, false);

    const wrongSubject = structuredClone(session);
    wrongSubject.job.events.find((e) => e.kind === 'sts-assume-kms-web-identity').subject =
      'system:serviceaccount:other:other';
    assert.equal(scoreOffenseSession(wrongSubject).success, false);

    const wrongDecryptRole = structuredClone(session);
    wrongDecryptRole.job.events.find((e) => e.kind === 'sts-assume-kms-web-identity').role_arn =
      'arn:aws:iam::000000000000:role/other';
    assert.equal(scoreOffenseSession(wrongDecryptRole).success, false);

    const wrongBrokerSubject = structuredClone(session);
    wrongBrokerSubject.job.events.find((e) => e.kind === 'broker-token-issued').subject =
      'system:serviceaccount:other:other';
    assert.equal(scoreOffenseSession(wrongBrokerSubject).success, false);

    const wrongBrokerToken = structuredClone(session);
    wrongBrokerToken.job.events.find((e) => e.kind === 'sts-assume-kms-web-identity').token_ref =
      'other';
    assert.equal(scoreOffenseSession(wrongBrokerToken).success, false);

    const wrongBrokerEntitlement = structuredClone(session);
    wrongBrokerEntitlement.job.events.find(
      (e) => e.kind === 'broker-token-issued',
    ).session_tags.entitlement_id = 'wrong-entitlement';
    assert.equal(scoreOffenseSession(wrongBrokerEntitlement).success, false);

    const wrongSessionPolicy = structuredClone(session);
    wrongSessionPolicy.job.events.find(
      (e) => e.kind === 'sts-assume-kms-web-identity',
    ).session_policy_ref = 'other';
    assert.equal(scoreOffenseSession(wrongSessionPolicy).success, false);

    const wrongKmsSession = structuredClone(session);
    wrongKmsSession.job.events.find((e) => e.kind === 'kms-decrypt').access_key_ref = 'other';
    assert.equal(scoreOffenseSession(wrongKmsSession).success, false);

    const wrongKmsEntitlement = structuredClone(session);
    wrongKmsEntitlement.job.events.find(
      (e) => e.kind === 'kms-decrypt-request',
    ).session_tags.entitlement_id = 'wrong-entitlement';
    assert.equal(scoreOffenseSession(wrongKmsEntitlement).success, false);

    const wrongBlob = structuredClone(session);
    wrongBlob.job.events.find((e) => e.kind === 'kms-decrypt').encrypted_data_key_ref = 'other';
    assert.equal(scoreOffenseSession(wrongBlob).success, false);

    const wrongKey = structuredClone(session);
    wrongKey.job.events.find((e) => e.kind === 'kms-decrypt').key_arn = 'other';
    assert.equal(scoreOffenseSession(wrongKey).success, false);

    const wrongContext = structuredClone(session);
    wrongContext.job.events.find((e) => e.kind === 'broker-token-request').encryption_context_ref =
      'other';
    assert.equal(scoreOffenseSession(wrongContext).success, false);

    const changedBrokerSnapshot = structuredClone(session);
    const brokerRequest = changedBrokerSnapshot.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    changedBrokerSnapshot.job.brokerSnapshots[brokerRequest.broker_snapshot_ref].policy.namespace =
      'other';
    assert.equal(scoreOffenseSession(changedBrokerSnapshot).success, false);

    const changedTrustSnapshot = structuredClone(session);
    const trustRequest = changedTrustSnapshot.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    const trustProfile = changedTrustSnapshot.job.brokerSnapshots[
      trustRequest.broker_snapshot_ref
    ].profiles.find((profile) => profile.id === trustRequest.profile_id);
    trustProfile.trust.subject = 'system:serviceaccount:other:other';
    assert.equal(scoreOffenseSession(changedTrustSnapshot).success, false);

    const missingTagPermission = structuredClone(session);
    const tagRequest = missingTagPermission.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    missingTagPermission.job.brokerSnapshots[tagRequest.broker_snapshot_ref].profiles.find(
      (profile) => profile.id === tagRequest.profile_id,
    ).trust.allowed_actions = ['sts:AssumeRoleWithWebIdentity'];
    assert.equal(scoreOffenseSession(missingTagPermission).success, false);

    const changedSessionSnapshot = structuredClone(session);
    const sessionRequest = changedSessionSnapshot.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    const sessionProfile = changedSessionSnapshot.job.brokerSnapshots[
      sessionRequest.broker_snapshot_ref
    ].profiles.find((profile) => profile.id === sessionRequest.profile_id);
    sessionProfile.session_policy.statements = [];
    assert.equal(scoreOffenseSession(changedSessionSnapshot).success, false);

    const deniedRoleSnapshot = structuredClone(session);
    const roleRequest = deniedRoleSnapshot.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    deniedRoleSnapshot.job.brokerSnapshots[roleRequest.broker_snapshot_ref].profiles
      .find((profile) => profile.id === roleRequest.profile_id)
      .role.permissions.push({
        effect: 'Deny',
        action: 'kms:Decrypt',
        resource: roleRequest.key_arn,
      });
    assert.equal(scoreOffenseSession(deniedRoleSnapshot).success, false);

    const deniedSessionSnapshot = structuredClone(session);
    const denyRequest = deniedSessionSnapshot.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    deniedSessionSnapshot.job.brokerSnapshots[denyRequest.broker_snapshot_ref].profiles
      .find((profile) => profile.id === denyRequest.profile_id)
      .session_policy.statements.push({
        effect: 'Deny',
        action: 'kms:Decrypt',
        resource: denyRequest.key_arn,
      });
    assert.equal(scoreOffenseSession(deniedSessionSnapshot).success, false);

    const changedKeySnapshot = structuredClone(session);
    const keyRequest = changedKeySnapshot.job.events.find((e) => e.kind === 'broker-token-request');
    changedKeySnapshot.job.keyPolicySnapshots[keyRequest.key_policy_snapshot_ref].grants = [];
    assert.equal(scoreOffenseSession(changedKeySnapshot).success, false);

    const changedEntitlementDeny = structuredClone(session);
    const entitlementRequest = changedEntitlementDeny.job.events.find(
      (e) => e.kind === 'broker-token-request',
    );
    changedEntitlementDeny.job.keyPolicySnapshots[
      entitlementRequest.key_policy_snapshot_ref
    ].explicit_denies.find(
      (deny) => deny.condition?.key === 'aws:PrincipalTag/entitlement_id',
    ).condition.value = 'wrong-entitlement';
    assert.equal(scoreOffenseSession(changedEntitlementDeny).success, false);

    const guessedMarker = structuredClone(session);
    guessedMarker.job.events = guessedMarker.job.events.filter(
      (e) => e.kind !== 'job-artifact-read',
    );
    assert.equal(scoreOffenseSession(guessedMarker).success, false);

    const lateBrokerPolicy = structuredClone(session);
    lateBrokerPolicy.job.brokerPolicy = { allow_profiles: [] };
    assert.equal(
      scoreOffenseSession(lateBrokerPolicy).success,
      true,
      'later broker policy edits cannot relabel a completed attempt',
    );

    const lateKeyPolicy = structuredClone(session);
    lateKeyPolicy.job.decryptKeyPolicy = { grants: [] };
    assert.equal(
      scoreOffenseSession(lateKeyPolicy).success,
      true,
      'later key policy edits cannot relabel a completed attempt',
    );
  }
}

const visibleSpec = { seed: 9940, family: FAMILIES[0] };
assert.throws(
  () =>
    referenceOffense(visibleSpec, (session, command) => {
      const response = stepOffense(session, command);
      return command.tool === 'get-bucket-policy'
        ? { ...response, value: { bucket: response.value.bucket } }
        : response;
    }),
  /reference access-point route/,
  'an ok:true response without bucket delegation cannot choose a reference route',
);

assert.throws(
  () =>
    referenceOffense(visibleSpec, (session, command) => {
      const response = stepOffense(session, command);
      return command.tool === 'get-object-metadata'
        ? { ...response, value: { ...response.value, wrapping_key_id: 'other' } }
        : response;
    }),
  /reference decrypt profile/,
  'an ok:true response with the wrong wrapping key cannot choose a decrypt profile',
);

let metadataQueried = false;
const visibleReference = referenceOffense(visibleSpec, (session, command) => {
  const response = stepOffense(session, command);
  if (command.tool === 'get-object-metadata') {
    metadataQueried = true;
    session.job.objectRecords[command.args.object_ref].key_arn = 'private-state-poison';
  }
  return response;
});
assert.equal(metadataQueried, true, 'reference must query visible object metadata');
assert.equal(
  visibleReference.score.success,
  true,
  'private post-checkpoint edit cannot relabel read',
);

console.log('v9 offense self-test passed');
