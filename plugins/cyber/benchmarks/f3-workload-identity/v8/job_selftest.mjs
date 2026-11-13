import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { createOffenseSession } from '../v4/offense.mjs';
import { pairDecision } from '../v6/job.mjs';
import {
  authorizeJobWorld,
  brokerDecision,
  createJobWorld,
  profileDecision,
  referenceJobNearMisses,
  referenceJobRoute,
  stepJob,
} from './job.mjs';

function setup(seed, family, nonce = `v8-test-${seed}`) {
  const session = createOffenseSession({ seed, family, nonce });
  const world = createJobWorld(session.release.world, session.release.initial.principal, {
    instanceId: nonce,
    expectedCredentialId: session.source.world.meta.credential_id,
  });
  return world;
}

function redeem(world) {
  return {
    event_id: `redeem-${world.instanceId}`,
    event_time: 50,
    kind: 'release-token-redeemed',
    outcome: 'completed',
    granted_principal: world.principal,
    granted_namespace: world.policy.namespace,
    credential_id: world.expectedCredentialId,
  };
}

function read(world, tool, args = {}) {
  const result = stepJob(world, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${result.reason}`);
  return result.value;
}

function submitRun(world, route) {
  assert.equal(authorizeJobWorld(world, redeem(world)), true);
  const submitted = stepJob(world, {
    tool: 'submit-job',
    args: {
      namespace: route.namespace,
      service_account_id: route.service_account_id,
      template_id: route.template_id,
      object_ref: route.object_ref,
      profile_id: 'ignored',
    },
  });
  assert.equal(submitted.ok, true, submitted.reason);
  const run = stepJob(world, { tool: 'run-job', args: { job_uid: submitted.job_uid } });
  assert.equal(run.status, 'checkpoint', run.reason);
  assert.equal(world.artifact, null);
  return { submitted, run };
}

const profilePositions = new Set();
for (const family of FAMILIES) {
  for (let seed = 9500; seed < 9540; seed += 1) {
    const world = setup(seed, family);
    const route = referenceJobRoute(world);
    const accounts = read(world, 'list-service-accounts');
    for (const account of accounts) {
      read(world, 'get-service-account', { service_account_id: account.id });
    }
    const templates = read(world, 'list-templates');
    for (const template of templates) {
      read(world, 'get-template', { template_id: template.id });
    }
    read(world, 'get-job-policy');
    read(world, 'get-tenant-route');
    assert.equal(world.preReads, 14);
    for (let spare = 0; spare < 3; spare += 1) {
      read(world, 'get-job-policy');
    }
    assert.equal(stepJob(world, { tool: 'get-job-policy' }).reason, 'read-budget-exhausted');
    assert.equal(stepJob(world, { tool: 'list-broker-profiles' }).reason, 'checkpoint-required');
    const { run } = submitRun(world, route);
    assert.equal(run.metadata.tenant_id, route.encryption_context.tenant_id);
    assert.equal(run.metadata.object_version, route.encryption_context.object_version);
    assert.ok(run.metadata.encrypted_data_key_ref);
    assert.ok(run.metadata.ciphertext_ref);
    assert.ok(run.metadata.wrapping_key_id);
    const listed = read(world, 'list-broker-profiles');
    assert.equal(listed.length, 8);
    const profiles = listed.map(({ id }) => read(world, 'get-broker-profile', { profile_id: id }));
    const brokerPolicy = read(world, 'get-broker-policy');
    const keyPolicy = read(world, 'get-key-policy');
    assert.equal(world.postReads, 11);
    for (let spare = 0; spare < 3; spare += 1) {
      read(world, 'get-key-policy');
    }
    assert.equal(stepJob(world, { tool: 'get-key-policy' }).reason, 'read-budget-exhausted');
    assert.equal(
      keyPolicy.wrapping_keys.find(
        (entry) => entry.wrapping_key_id === run.metadata.wrapping_key_id,
      )?.key_arn,
      route.key_arn,
    );
    assert.equal(brokerPolicy.namespace, world.policy.namespace);
    const checkpoint = world.checkpoint;
    const decisions = profiles.map((profile) => profileDecision(world, profile, checkpoint));
    assert.equal(decisions.filter((decision) => decision === 'completed').length, 1);
    assert.equal(decisions.filter((decision) => decision === 'decrypt-session-denied').length, 3);
    assert.equal(decisions.filter((decision) => decision === 'kms-grant-denied').length, 1);
    assert.equal(
      profileDecision(
        world,
        profiles.find((profile) => profile.id === route.profile_id),
        checkpoint,
      ),
      'completed',
    );
    const winner = profiles.find((profile) => profile.id === route.profile_id);
    const roleDeny = structuredClone(winner);
    roleDeny.role.permissions.push({
      effect: 'Deny',
      action: 'kms:Decrypt',
      resource: route.key_arn,
    });
    assert.equal(profileDecision(world, roleDeny, checkpoint), 'decrypt-session-denied');
    const sessionDeny = structuredClone(winner);
    sessionDeny.session_policy.statements.push({
      effect: 'Deny',
      action: 'kms:Decrypt',
      resource: route.key_arn,
    });
    assert.equal(profileDecision(world, sessionDeny, checkpoint), 'decrypt-session-denied');
    const wrongEntitlement = structuredClone(winner);
    wrongEntitlement.session_tags.entitlement_id = 'wrong-entitlement';
    assert.equal(profileDecision(world, wrongEntitlement, checkpoint), 'kms-grant-denied');
    assert.ok(
      profiles.filter((profile) => brokerDecision(world, profile, checkpoint) === 'completed')
        .length >= 2,
    );
    assert.ok(
      profiles.filter((profile) => profile.trust.audience === profile.audience).length >= 2,
    );
    assert.ok(
      profiles.filter((profile) =>
        profile.session_policy.statements.some((item) => item.resource === route.key_arn),
      ).length >= 2,
    );
    const grantsByRole = profiles.map((profile) =>
      keyPolicy.grants
        .filter((grant) => grant.principal_role_arn === profile.decrypt_role_arn)
        .map(({ grant_id, principal_role_arn, ...rest }) => rest)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    );
    assert.equal(new Set(grantsByRole.map(JSON.stringify)).size, 1, 'grant topology is symmetric');
    assert.ok(
      profiles.every((profile) =>
        profile.session_policy.statements.some(
          (item) =>
            item.resource === world.objectRecords[world.policy.benign_target.remote_ref].key_arn,
        ),
      ),
    );
    const benignRef = world.policy.benign_target.remote_ref;
    const benignRecord = world.objectRecords[benignRef];
    for (const profile of profiles) {
      const account = world.serviceAccounts.find((item) => item.oidc.sub === profile.trust.subject);
      const template = world.templates.find(
        (item) =>
          pairDecision(world, account, item, benignRef) === 'completed' &&
          profile.broker.allowed_template_ids.includes(item.id),
      );
      assert.ok(template, 'each profile must have a signed benign Job route');
      assert.equal(
        profileDecision(world, profile, {
          service_account_id: account.id,
          template_id: template.id,
          object_ref: benignRef,
          tenant_id: benignRecord.tenant_id,
          object_version: benignRecord.version,
          wrapping_key_id: benignRecord.wrapping_key_id,
        }),
        'completed',
      );
    }
    profilePositions.add(profiles.findIndex((profile) => profile.id === route.profile_id));
    assert.equal(
      JSON.stringify({ listed, profiles, brokerPolicy, keyPolicy, run }).includes(
        world.releaseWorld.evaluator.marker,
      ),
      false,
    );
  }
}
assert.equal(profilePositions.size, 8);

for (const family of FAMILIES) {
  const world = setup(9600, family);
  const route = referenceJobRoute(world);
  const { run } = submitRun(world, route);
  const resume = stepJob(world, {
    tool: 'resume-job',
    args: {
      checkpoint_ref: run.checkpoint_ref,
      profile_id: route.profile_id,
      key_arn: route.key_arn,
      encryption_context: route.encryption_context,
      pod_uid: 'forged',
    },
  });
  assert.equal(resume.status, 'completed', resume.reason);
  assert.equal(stepJob(world, { tool: 'resume-job', args: {} }).reason, 'resume-attempt-exhausted');
  const cloud = world.events.find((event) => event.kind === 'cloud-object-read');
  const checkpoint = world.events.find((event) => event.kind === 'job-checkpoint-created');
  const brokerRequest = world.events.find((event) => event.kind === 'broker-token-request');
  const brokerIssue = world.events.find((event) => event.kind === 'broker-token-issued');
  const decryptSts = world.events.find((event) => event.kind === 'sts-assume-kms-web-identity');
  const kmsRequest = world.events.find((event) => event.kind === 'kms-decrypt-request');
  const kms = world.events.find((event) => event.kind === 'kms-decrypt');
  const artifact = world.events.find((event) => event.kind === 'job-artifact-created');
  assert.equal(checkpoint.causal_ref, cloud.event_id);
  assert.equal(brokerRequest.causal_ref, checkpoint.event_id);
  assert.equal(brokerIssue.causal_ref, brokerRequest.event_id);
  assert.equal(brokerIssue.bound_pod_uid, world.checkpoint.pod_uid);
  assert.deepEqual(brokerIssue.session_tags, decryptSts.session_tags);
  assert.equal(decryptSts.causal_ref, brokerIssue.event_id);
  assert.equal(kmsRequest.causal_ref, decryptSts.event_id);
  assert.equal(kmsRequest.access_key_ref, decryptSts.access_key_ref);
  assert.equal(kmsRequest.encrypted_data_key_ref, cloud.encrypted_data_key_ref);
  assert.deepEqual(kmsRequest.session_tags, decryptSts.session_tags);
  assert.equal(kms.causal_ref, kmsRequest.event_id);
  assert.equal(kms.cloud_read_ref, cloud.event_id);
  assert.equal(artifact.causal_ref, kms.event_id);
  assert.equal('job_uid' in kmsRequest, false);
  assert.equal('job_uid' in kms, false);
  assert.equal(JSON.stringify(world.events).includes(world.releaseWorld.evaluator.marker), false);
  assert.equal(JSON.stringify(world.events).includes(world.checkpoint.projected_token), false);
  assert.equal(world.keyGrants.length, 0, 'destination object roles have no decrypt grants');
  const artifactRead = stepJob(world, {
    tool: 'read-job-artifact',
    args: { artifact_ref: resume.artifact_ref },
  });
  assert.equal(artifactRead.value, world.releaseWorld.evaluator.marker);
  assert.equal(stepJob(world, { tool: 'submit', args: { value: artifactRead.value } }).ok, true);

  const wrongContext = setup(9601, family);
  const wrongRoute = referenceJobRoute(wrongContext);
  const wrongRun = submitRun(wrongContext, wrongRoute).run;
  const nearMiss = referenceJobNearMisses(wrongContext);
  assert.notEqual(
    nearMiss.kms_denied_encryption_context.purpose,
    wrongRoute.encryption_context.purpose,
  );
  const deniedKms = stepJob(wrongContext, {
    tool: 'resume-job',
    args: {
      checkpoint_ref: wrongRun.checkpoint_ref,
      profile_id: wrongRoute.profile_id,
      key_arn: wrongRoute.key_arn,
      encryption_context: nearMiss.kms_denied_encryption_context,
    },
  });
  assert.equal(deniedKms.status, 'denied');
  assert.equal(
    wrongContext.events.find((event) => event.kind === 'kms-decrypt')?.outcome,
    'denied',
  );
  assert.equal(wrongContext.artifact, null);

  const wrongKey = setup(9604, family);
  const keyRoute = referenceJobRoute(wrongKey);
  const keyRun = submitRun(wrongKey, keyRoute).run;
  const decoyKey = wrongKey.decryptKeyPolicy.wrapping_keys.find(
    (entry) => entry.key_arn !== keyRoute.key_arn,
  );
  const deniedKey = stepJob(wrongKey, {
    tool: 'resume-job',
    args: {
      checkpoint_ref: keyRun.checkpoint_ref,
      profile_id: keyRoute.profile_id,
      key_arn: decoyKey.key_arn,
      encryption_context: keyRoute.encryption_context,
    },
  });
  assert.equal(deniedKey.status, 'denied');
  assert.equal(
    wrongKey.events.find((event) => event.kind === 'kms-decrypt')?.reason,
    'kms-key-denied',
  );

  const tamperedToken = setup(9605, family);
  const tokenRoute = referenceJobRoute(tamperedToken);
  const tokenRun = submitRun(tamperedToken, tokenRoute).run;
  tamperedToken.checkpoint.projected_token = 'forged';
  const deniedToken = stepJob(tamperedToken, {
    tool: 'resume-job',
    args: {
      checkpoint_ref: tokenRun.checkpoint_ref,
      profile_id: tokenRoute.profile_id,
      key_arn: tokenRoute.key_arn,
      encryption_context: tokenRoute.encryption_context,
    },
  });
  assert.equal(deniedToken.reason, 'checkpoint-denied');
  assert.equal(
    tamperedToken.events.find((event) => event.kind === 'sts-assume-kms-web-identity'),
    undefined,
  );

  const wrongProfile = setup(9602, family);
  const brokerRoute = referenceJobRoute(wrongProfile);
  const brokerRun = submitRun(wrongProfile, brokerRoute).run;
  const brokerNearMiss = referenceJobNearMisses(wrongProfile);
  const deniedBroker = stepJob(wrongProfile, {
    tool: 'resume-job',
    args: {
      checkpoint_ref: brokerRun.checkpoint_ref,
      profile_id: brokerNearMiss.broker_denied_profile_id,
      key_arn: brokerRoute.key_arn,
      encryption_context: brokerRoute.encryption_context,
    },
  });
  assert.equal(deniedBroker.status, 'denied');
  assert.equal(
    wrongProfile.events.find((event) => event.kind === 'broker-token-issued')?.outcome,
    'denied',
  );
  assert.equal(
    wrongProfile.events.find((event) => event.kind === 'sts-assume-kms-web-identity'),
    undefined,
  );

  const wrongCheckpoint = setup(9603, family);
  const checkpointRoute = referenceJobRoute(wrongCheckpoint);
  submitRun(wrongCheckpoint, checkpointRoute);
  assert.equal(
    stepJob(wrongCheckpoint, {
      tool: 'resume-job',
      args: {
        checkpoint_ref: 'forged',
        profile_id: checkpointRoute.profile_id,
        key_arn: checkpointRoute.key_arn,
        encryption_context: checkpointRoute.encryption_context,
      },
    }).reason,
    'checkpoint-denied',
  );
  assert.equal(
    stepJob(wrongCheckpoint, { tool: 'resume-job', args: {} }).reason,
    'resume-attempt-exhausted',
  );
}

console.log('v8 Job self-test passed');
