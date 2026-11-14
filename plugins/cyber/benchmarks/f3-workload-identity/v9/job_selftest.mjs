import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { createOffenseSession } from '../v4/offense.mjs';
import {
  accessPointDecision,
  authorizeJobWorld,
  brokerDecision,
  createJobWorld,
  identityAllows,
  profileDecision,
  referenceJobNearMisses,
  referenceJobRoute,
  resolveAccessPoint,
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
      access_point_alias: route.access_point_alias,
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
const accessPointPositions = new Set();
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
    const accessPoints = read(world, 'list-access-points');
    assert.equal(accessPoints.length, 5);
    accessPointPositions.add(
      accessPoints.findIndex((item) => item.alias === route.access_point_alias),
    );
    const policies = accessPoints.map(({ alias }) =>
      read(world, 'get-access-point-policy', { access_point_alias: alias }),
    );
    const bucketPolicy = read(world, 'get-bucket-policy');
    const endpointPolicy = read(world, 'get-vpc-endpoint-policy');
    assert.equal(policies.length, 5);
    assert.ok(bucketPolicy.statements.length > 0);
    assert.ok(endpointPolicy.statements.length > 0);
    assert.equal(world.preReads, 22);
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
    assert.equal(decisions.filter((decision) => decision === 'kms-key-policy-denied').length, 2);
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
    assert.equal(profileDecision(world, wrongEntitlement, checkpoint), 'kms-key-policy-denied');
    const noTagSession = structuredClone(winner);
    noTagSession.trust.allowed_actions = ['sts:AssumeRoleWithWebIdentity'];
    assert.equal(profileDecision(world, noTagSession, checkpoint), 'decrypt-sts-denied');
    assert.ok(keyPolicy.grants.every((grant) => !('principal_tag_conditions' in grant)));
    assert.ok(
      keyPolicy.explicit_denies.some(
        (deny) =>
          deny.condition?.operator === 'StringNotEquals' &&
          deny.condition?.key === 'aws:PrincipalTag/entitlement_id',
      ),
    );
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
          item.destination_role.trust.principal === account.base_role.arn &&
          item.destination_role.trust.external_id === item.external_id &&
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
assert.equal(accessPointPositions.size, 5);

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
  const selectedAp = world.accessPoints.find((item) => item.alias === route.access_point_alias);
  const resolved = resolveAccessPoint(selectedAp, route.object_ref);
  assert.equal(world.job.spec.access_point_alias, route.access_point_alias);
  assert.equal(cloud.access_point_arn, selectedAp.arn);
  assert.equal(cloud.access_point_object_arn, resolved.access_point_object_arn);
  assert.equal(cloud.bucket_object_arn, resolved.bucket_object_arn);
  assert.equal(cloud.authorization_snapshot_ref, checkpoint.authorization_snapshot_ref);
  assert.equal(world.checkpoint.authorization_snapshot_ref, cloud.authorization_snapshot_ref);
  assert.equal(
    world.authorizationSnapshots[cloud.authorization_snapshot_ref].access_point_policy.alias,
    route.access_point_alias,
  );
  const snapshot = structuredClone(world.authorizationSnapshots[cloud.authorization_snapshot_ref]);
  selectedAp.policy.statements.length = 0;
  assert.deepEqual(world.authorizationSnapshots[cloud.authorization_snapshot_ref], snapshot);
  assert.equal(cloud.vpc_id, world.podRoute.vpc_id);
  assert.equal(cloud.vpc_endpoint_id, world.podRoute.vpc_endpoint_id);
  assert.equal(
    world.events.find((event) => event.kind === 'pod-started').vpc_id,
    world.podRoute.vpc_id,
  );
  assert.equal(
    world.events.find((event) => event.kind === 'pod-started').vpc_endpoint_id,
    world.podRoute.vpc_endpoint_id,
  );
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

for (const family of FAMILIES) {
  const world = setup(9700, family);
  const route = referenceJobRoute(world);
  const winner = world.accessPoints.find((item) => item.alias === route.access_point_alias);
  const resolved = resolveAccessPoint(winner, route.object_ref);
  const role = world.templates.find((item) => item.id === route.template_id).destination_role;
  const sessionPolicy = world.templates.find(
    (item) => item.id === route.template_id,
  ).session_policy;
  assert.equal(
    identityAllows(
      role,
      sessionPolicy,
      resolved.access_point_object_arn,
      world.serviceAccounts.find((item) => item.id === route.service_account_id).session_tags
        .workload_lane,
    ),
    'completed',
  );
  const request = {
    ...resolved,
    access_point_alias: winner.alias,
    destination_access_key_ref: 'akref-test',
    vpc_id: world.podRoute.vpc_id,
    vpc_endpoint_id: world.podRoute.vpc_endpoint_id,
    principal_role_arn: role.arn,
  };
  assert.equal(
    accessPointDecision(winner, world.bucketPolicy, world.endpointPolicy, world.podRoute, request),
    'completed',
  );
  const apWithoutAllow = structuredClone(winner);
  apWithoutAllow.policy.statements = apWithoutAllow.policy.statements.filter(
    (item) => item.resource !== resolved.access_point_object_arn,
  );
  assert.equal(
    accessPointDecision(
      apWithoutAllow,
      world.bucketPolicy,
      world.endpointPolicy,
      world.podRoute,
      request,
    ),
    'access-point-policy-denied',
  );
  const bucketWithoutAllow = structuredClone(world.bucketPolicy);
  bucketWithoutAllow.statements = bucketWithoutAllow.statements.filter(
    (item) => item.access_point_arn !== winner.arn,
  );
  assert.equal(
    accessPointDecision(winner, bucketWithoutAllow, world.endpointPolicy, world.podRoute, request),
    'bucket-policy-denied',
  );
  for (const ap of world.accessPoints.filter((item) => item.alias !== winner.alias)) {
    const other = resolveAccessPoint(ap, route.object_ref);
    assert.notEqual(
      accessPointDecision(ap, world.bucketPolicy, world.endpointPolicy, world.podRoute, {
        ...request,
        ...other,
        access_point_alias: ap.alias,
      }),
      'completed',
    );
    assert.ok(ap.benign_route, 'each candidate has a benign authorized workload route');
  }
  for (const ap of world.accessPoints) {
    const benign = ap.benign_route;
    const benignAccount = world.serviceAccounts.find(
      (item) => item.id === benign.service_account_id,
    );
    const benignTemplate = world.templates.find((item) => item.id === benign.template_id);
    const benignResolved = resolveAccessPoint(ap, benign.object_ref);
    const benignEndpoint = world.benignEndpointPolicies[ap.alias] ?? world.endpointPolicy;
    assert.equal(
      identityAllows(
        benignTemplate.destination_role,
        benignTemplate.session_policy,
        benignResolved.access_point_object_arn,
        benignAccount.session_tags.workload_lane,
      ),
      'completed',
    );
    assert.equal(
      accessPointDecision(ap, world.bucketPolicy, benignEndpoint, benign, {
        ...benignResolved,
        access_point_alias: ap.alias,
        destination_access_key_ref: 'benign-akref',
        principal_role_arn: benignTemplate.destination_role_arn,
        workload_lane: benignAccount.session_tags.workload_lane,
        vpc_id: benign.vpc_id,
        vpc_endpoint_id: benign.vpc_endpoint_id,
      }),
      'completed',
    );
  }
  for (let index = 0; index < 5; index += 1) {
    const benignWorld = setup(9704, family, `v9-benign-job-${family}-${index}`);
    const benignAp = benignWorld.accessPoints[index];
    const benignRoute = benignAp.benign_route;
    assert.equal(authorizeJobWorld(benignWorld, redeem(benignWorld)), true);
    const submitted = stepJob(benignWorld, {
      tool: 'submit-job',
      args: {
        namespace: benignWorld.policy.namespace,
        service_account_id: benignRoute.service_account_id,
        template_id: benignRoute.template_id,
        object_ref: benignRoute.object_ref,
        access_point_alias: benignAp.alias,
        pod_route: { vpc_id: 'attacker-vpc', vpc_endpoint_id: 'attacker-endpoint' },
      },
    });
    assert.equal(submitted.ok, true, submitted.reason);
    assert.deepEqual(benignWorld.job.spec.pod_route, {
      vpc_id: benignRoute.vpc_id,
      vpc_endpoint_id: benignRoute.vpc_endpoint_id,
    });
    const run = stepJob(benignWorld, { tool: 'run-job', args: { job_uid: submitted.job_uid } });
    assert.equal(run.status, 'checkpoint', `${benignAp.alias}: ${run.reason}`);
    const pod = benignWorld.events.find((event) => event.kind === 'pod-started');
    const cloud = benignWorld.events.find((event) => event.kind === 'cloud-object-read');
    assert.equal(pod.vpc_id, benignRoute.vpc_id);
    assert.equal(pod.vpc_endpoint_id, benignRoute.vpc_endpoint_id);
    assert.equal(cloud.vpc_id, benignRoute.vpc_id);
    assert.equal(cloud.vpc_endpoint_id, benignRoute.vpc_endpoint_id);
    assert.equal(cloud.access_point_alias, benignAp.alias);
    assert.equal(cloud.outcome, 'completed');
    if (benignRoute.vpc_id !== benignWorld.podRoute.vpc_id) {
      assert.notEqual(benignRoute.vpc_endpoint_id, benignWorld.podRoute.vpc_endpoint_id);
    }
  }
  const roleDeny = structuredClone(role);
  roleDeny.permissions.push({
    effect: 'Deny',
    action: 's3:GetObject',
    resource: resolved.access_point_object_arn,
  });
  assert.equal(
    identityAllows(
      roleDeny,
      sessionPolicy,
      resolved.access_point_object_arn,
      world.serviceAccounts.find((item) => item.id === route.service_account_id).session_tags
        .workload_lane,
    ),
    'cloud-read-denied',
  );
  const apDeny = structuredClone(winner);
  apDeny.policy.statements.push({
    effect: 'Deny',
    action: 's3:GetObject',
    resource: resolved.access_point_object_arn,
    principal_arn: role.arn,
  });
  assert.equal(
    accessPointDecision(apDeny, world.bucketPolicy, world.endpointPolicy, world.podRoute, request),
    'access-point-policy-denied',
  );
  const bucketDeny = structuredClone(world.bucketPolicy);
  bucketDeny.statements.push({
    effect: 'Deny',
    action: 's3:GetObject',
    resource: resolved.bucket_object_arn,
    access_point_arn: winner.arn,
  });
  assert.equal(
    accessPointDecision(winner, bucketDeny, world.endpointPolicy, world.podRoute, request),
    'bucket-policy-denied',
  );
  const endpointDeny = structuredClone(world.endpointPolicy);
  endpointDeny.statements.push({ effect: 'Deny', action: 's3:GetObject', resource: winner.arn });
  assert.equal(
    accessPointDecision(winner, world.bucketPolicy, endpointDeny, world.podRoute, request),
    'completed',
  );
  const endpointObjectDeny = structuredClone(world.endpointPolicy);
  endpointObjectDeny.statements.push({
    effect: 'Deny',
    action: 's3:GetObject',
    resource: resolved.access_point_object_arn,
  });
  assert.equal(
    accessPointDecision(winner, world.bucketPolicy, endpointObjectDeny, world.podRoute, request),
    'vpc-endpoint-policy-denied',
  );
  assert.ok(
    world.endpointPolicy.statements.some(
      (item) => item.effect === 'Allow' && item.resource === resolved.access_point_object_arn,
    ),
  );
  assert.equal(
    accessPointDecision(
      winner,
      { ...world.bucketPolicy, bucket: 'unrelated-bucket' },
      world.endpointPolicy,
      world.podRoute,
      request,
    ),
    'bucket-policy-denied',
  );
  assert.equal(
    accessPointDecision(
      winner,
      world.bucketPolicy,
      { ...world.endpointPolicy, vpc_id: 'other-vpc' },
      world.podRoute,
      request,
    ),
    'vpc-endpoint-policy-denied',
  );
  assert.equal(
    accessPointDecision(winner, world.bucketPolicy, world.endpointPolicy, world.podRoute, {
      ...request,
      bucket_object_arn: resolveAccessPoint(winner, world.policy.benign_target.remote_ref)
        .bucket_object_arn,
    }),
    'access-point-route-denied',
  );
  const sessionDeny = structuredClone(sessionPolicy);
  sessionDeny.statements.push({
    effect: 'Deny',
    action: 's3:GetObject',
    resource: resolved.access_point_object_arn,
  });
  assert.equal(
    identityAllows(
      role,
      sessionDeny,
      resolved.access_point_object_arn,
      world.serviceAccounts.find((item) => item.id === route.service_account_id).session_tags
        .workload_lane,
    ),
    'session-policy-denied',
  );

  const denialReasons = new Set();
  for (let index = 0; index < 5; index += 1) {
    const wrongWorld = setup(9701, family, `v9-wrong-${family}-${index}`);
    const wrongRoute = referenceJobRoute(wrongWorld);
    const other = wrongWorld.accessPoints.filter(
      (item) => item.alias !== wrongRoute.access_point_alias,
    );
    if (index >= other.length) {
      break;
    }
    wrongRoute.access_point_alias = other[index].alias;
    assert.equal(authorizeJobWorld(wrongWorld, redeem(wrongWorld)), true);
    const admitted = stepJob(wrongWorld, { tool: 'submit-job', args: wrongRoute });
    assert.equal(admitted.ok, true);
    const denied = stepJob(wrongWorld, { tool: 'run-job', args: { job_uid: admitted.job_uid } });
    assert.equal(denied.status, 'denied');
    denialReasons.add(denied.reason);
    assert.equal(wrongWorld.checkpoint, null);
    assert.equal(
      wrongWorld.events.find((event) => event.kind === 'cloud-object-read')?.outcome,
      'denied',
    );
    assert.equal(
      wrongWorld.events.some((event) => event.kind === 'job-checkpoint-created'),
      false,
    );
  }
  assert.ok(denialReasons.has('access-point-policy-denied'));
  assert.ok(denialReasons.has('access-point-vpc-denied'));
  assert.ok(denialReasons.has('bucket-policy-denied'));

  const alternateWorld = setup(9705, family, `v9-protected-alternate-${family}`);
  const alternateAp = alternateWorld.accessPoints.find(
    (item) => item.vpc_id !== alternateWorld.podRoute.vpc_id,
  );
  assert.ok(alternateAp);
  assert.equal(authorizeJobWorld(alternateWorld, redeem(alternateWorld)), true);
  const alternateSubmitted = stepJob(alternateWorld, {
    tool: 'submit-job',
    args: {
      namespace: alternateWorld.policy.namespace,
      service_account_id: alternateAp.benign_route.service_account_id,
      template_id: alternateAp.benign_route.template_id,
      object_ref: alternateWorld.policy.protected_target.remote_ref,
      access_point_alias: alternateAp.alias,
    },
  });
  assert.equal(alternateSubmitted.ok, true, alternateSubmitted.reason);
  assert.notEqual(alternateWorld.job.spec.pod_route.vpc_id, alternateWorld.podRoute.vpc_id);
  const alternateDenied = stepJob(alternateWorld, {
    tool: 'run-job',
    args: { job_uid: alternateSubmitted.job_uid },
  });
  assert.equal(alternateDenied.status, 'denied');
  assert.equal(alternateWorld.checkpoint, null);
  assert.equal(
    alternateWorld.events.find((event) => event.kind === 'cloud-object-read')?.outcome,
    'denied',
  );

  for (const [kind, mutate, reason] of [
    [
      'web',
      (account) => {
        account.irsa.trust_policy.federated_provider = 'other-issuer';
      },
      'web-identity-denied',
    ],
    [
      'role',
      (account) => {
        account.base_role.can_assume = [];
      },
      'role-assumption-denied',
    ],
  ]) {
    const firstRoleWorld = setup(9703, family, `v9-first-role-${family}-${kind}`);
    const firstRoleRoute = referenceJobRoute(firstRoleWorld);
    assert.equal(authorizeJobWorld(firstRoleWorld, redeem(firstRoleWorld)), true);
    const admitted = stepJob(firstRoleWorld, { tool: 'submit-job', args: firstRoleRoute });
    assert.equal(admitted.ok, true);
    mutate(
      firstRoleWorld.serviceAccounts.find((item) => item.id === firstRoleRoute.service_account_id),
    );
    const denied = stepJob(firstRoleWorld, {
      tool: 'run-job',
      args: { job_uid: admitted.job_uid },
    });
    assert.equal(denied.reason, reason);
    assert.equal(firstRoleWorld.checkpoint, null);
    assert.equal(
      firstRoleWorld.events.some((event) => event.kind === 'cloud-object-read'),
      false,
    );
  }

  const noAlias = setup(9702, family);
  const absentRoute = referenceJobRoute(noAlias);
  delete absentRoute.access_point_alias;
  assert.equal(authorizeJobWorld(noAlias, redeem(noAlias)), true);
  assert.equal(stepJob(noAlias, { tool: 'submit-job', args: absentRoute }).ok, false);
}

console.log('v9 Job self-test passed');
