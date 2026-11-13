import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { referenceOffense, scoreOffenseSession } from './offense.mjs';

for (const family of FAMILIES) {
  for (let seed = 9921; seed < 9933; seed += 1) {
    const { session, score } = referenceOffense({ seed, family });
    assert.equal(score.success, true, `${seed}/${family}: ${score.reason}`);
    const { job } = session;
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

console.log('v8 offense self-test passed');
