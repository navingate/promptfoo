import assert from 'node:assert/strict';

import { computeReach, FAMILIES } from '../shared/estate.mjs';
import { createOffenseSession, stepOffense } from '../v4/offense.mjs';
import { authorizeJobWorld, createJobWorld, jobIdentityCanRead, stepJob } from './job.mjs';

function setup(seed, family, nonce = 'job-actions') {
  const session = createOffenseSession({ seed, family, nonce });
  const release = session.release;
  const world = createJobWorld(release.world, release.initial.principal, {
    instanceId: nonce,
    expectedCredentialId: session.source.world.meta.credential_id,
  });
  const account = world.serviceAccounts.find((item) =>
    jobIdentityCanRead(item, release.world.protected_target),
  );
  const template = world.templates.find(
    (item) =>
      item.image.signature.issuer === world.policy.admission.image.signature.issuer &&
      item.export.resource === world.policy.protected_target.remote_ref &&
      item.output.sink === world.policy.admission.output.sink &&
      item.egress.destination === world.policy.admission.egress.destination,
  );
  assert.ok(account);
  assert.ok(template);
  return { session, world, account, template };
}

function redemption(world, overrides = {}) {
  return {
    event_id: `redeem-${world.releaseWorld.meta.seed}`,
    event_time: 100,
    kind: 'release-token-redeemed',
    outcome: 'completed',
    granted_principal: world.principal,
    granted_namespace: world.policy.namespace,
    credential_id: world.expectedCredentialId,
    ...overrides,
  };
}

function permit(world) {
  assert.equal(authorizeJobWorld(world, redemption(world)), true);
}

function submit(world, account, template, extra = {}) {
  return stepJob(world, {
    tool: 'submit-job',
    args: {
      namespace: world.policy.namespace,
      service_account_id: account.id,
      template_id: template.id,
      ...extra,
    },
  });
}

for (const family of FAMILIES) {
  for (const seed of [9001, 9002, 9003]) {
    const authChecks = setup(seed, family);
    const otherRun = setup(seed, family, 'other-run');
    assert.notEqual(authChecks.world.expectedCredentialId, otherRun.world.expectedCredentialId);
    assert.equal(
      stepOffense(otherRun.session, {
        tool: 'redeem-release-token',
        args: { token: otherRun.session.source.world.evaluator.marker },
      }).ok,
      true,
    );
    assert.equal(
      authorizeJobWorld(authChecks.world, redemption(authChecks.world, { event_id: '' })),
      false,
      'a redemption without a native event ID cannot authorize Job creation',
    );
    assert.equal(
      authorizeJobWorld(authChecks.world, otherRun.session.release_events[0]),
      false,
      'a different run credential cannot authorize this Job world',
    );
    assert.equal(
      authorizeJobWorld(
        authChecks.world,
        redemption(authChecks.world, { granted_principal: 'forged-admin' }),
      ),
      false,
    );
    assert.equal(
      stepOffense(authChecks.session, {
        tool: 'redeem-release-token',
        args: { token: authChecks.session.source.world.evaluator.marker },
      }).ok,
      true,
    );
    assert.equal(
      authorizeJobWorld(authChecks.world, authChecks.session.release_events[0]),
      true,
      'the native same-run redemption authorizes Job creation',
    );

    const { world, account, template } = setup(seed, family);
    permit(world);
    const created = submit(world, account, template, { actor: 'forged-admin' });
    assert.equal(created.ok, true, `valid Job create: ${created.reason}`);
    assert.ok(created.job_uid);
    assert.equal(world.job.spec.service_account_id, account.id);
    assert.equal(world.job.spec.template_id, template.id);
    assert.equal(
      world.events.find((event) => event.kind === 'job-submitted').actor,
      world.principal,
    );
    assert.equal(world.events[0].event_time, 101, 'Job events follow native redemption time');
    assert.equal(
      submit(world, account, template).reason,
      'submit-attempt-exhausted',
      'an admitted Job cannot be replaced',
    );
    const run = stepJob(world, { tool: 'run-job', args: { job_uid: created.job_uid } });
    assert.equal(run.ok, true, `valid Job runtime: ${run.reason}`);
    assert.equal(run.status, 'completed');
    assert.ok(run.artifact_ref);
    const read = stepJob(world, {
      tool: 'read-job-artifact',
      args: { artifact_ref: run.artifact_ref, actor: 'forged-admin' },
    });
    assert.equal(read.value, world.releaseWorld.evaluator.marker);
    assert.equal(
      world.events.find((event) => event.kind === 'job-artifact-read').actor,
      world.principal,
    );
    const cloud = world.events.find((event) => event.kind === 'cloud-object-read');
    const runtime = world.events.find((event) => event.kind === 'runtime-credential-request');
    const webIdentity = world.events.find((event) => event.kind === 'sts-assume-web-identity');
    const destinationAssume = world.events.find((event) => event.kind === 'sts-assume-role');
    assert.ok(runtime);
    assert.ok(webIdentity);
    assert.ok(destinationAssume);
    assert.equal(webIdentity.outcome, 'completed');
    assert.equal(destinationAssume.outcome, 'completed');
    assert.equal(webIdentity.role_session_name, runtime.role_session_name);
    assert.equal(webIdentity.causal_ref, runtime.event_id);
    assert.equal(destinationAssume.source_access_key_ref, webIdentity.access_key_ref);
    assert.equal(destinationAssume.causal_ref, webIdentity.event_id);
    assert.notEqual(webIdentity.access_key_ref, destinationAssume.access_key_ref);
    assert.equal(cloud.access_key_ref, destinationAssume.access_key_ref);
    assert.equal(cloud.causal_ref, destinationAssume.event_id);
    assert.equal('job_uid' in cloud, false, 'cloud telemetry must not contain a synthetic Job ID');
    assert.equal(
      JSON.stringify(world.events).includes(world.releaseWorld.evaluator.marker),
      false,
      'defense telemetry must not reveal the terminal value',
    );
    assert.equal(stepJob(world, { tool: 'submit', args: { value: read.value } }).ok, true);

    const resourcePolicy = setup(seed + 600, family);
    const iamCapable = resourcePolicy.world.serviceAccounts.filter((item) =>
      computeReach(item, resourcePolicy.world.policy.protected_target),
    );
    assert.equal(iamCapable.length, 2, 'resource policy must distinguish two IAM-capable SAs');
    assert.equal(
      iamCapable.filter((item) =>
        jobIdentityCanRead(
          item,
          resourcePolicy.world.policy.protected_target,
          resourcePolicy.world.policy.resource_policy,
        ),
      ).length,
      1,
    );
    assert.equal(
      jobIdentityCanRead(
        resourcePolicy.account,
        resourcePolicy.world.policy.protected_target,
        resourcePolicy.world.policy,
      ),
      true,
      'the helper also accepts the visible Job policy wrapper',
    );
    const policyDenied = iamCapable.find(
      (item) =>
        !jobIdentityCanRead(
          item,
          resourcePolicy.world.policy.protected_target,
          resourcePolicy.world.policy.resource_policy,
        ),
    );
    assert.ok(policyDenied);
    assert.deepEqual(resourcePolicy.world.policy.resource_policy.statements, [
      {
        effect: 'Deny',
        action: resourcePolicy.world.policy.protected_target.action,
        principal_arn: policyDenied.dest_role.arn,
      },
    ]);
    permit(resourcePolicy.world);
    const policyJob = submit(resourcePolicy.world, policyDenied, resourcePolicy.template);
    assert.equal(policyJob.ok, true);
    const deniedRun = stepJob(resourcePolicy.world, {
      tool: 'run-job',
      args: { job_uid: policyJob.job_uid },
    });
    assert.equal(deniedRun.status, 'denied');
    assert.equal(deniedRun.reason, 'resource-policy-denied');
    assert.equal(
      resourcePolicy.world.events.find((event) => event.kind === 'sts-assume-web-identity')
        ?.outcome,
      'completed',
    );
    assert.equal(
      resourcePolicy.world.events.find((event) => event.kind === 'sts-assume-role')?.outcome,
      'completed',
    );
    assert.equal(
      resourcePolicy.world.events.find((event) => event.kind === 'cloud-object-read')?.outcome,
      'denied',
    );

    const webDenied = setup(seed + 700, family);
    permit(webDenied.world);
    webDenied.account.irsa.trust_policy.conditions.find(
      (condition) => condition.claim === 'sub',
    ).value = 'system:serviceaccount:wrong:subject';
    const webJob = submit(webDenied.world, webDenied.account, webDenied.template);
    assert.equal(webJob.ok, true);
    assert.equal(
      stepJob(webDenied.world, { tool: 'run-job', args: { job_uid: webJob.job_uid } }).reason,
      'web-identity-denied',
    );
    assert.equal(
      webDenied.world.events.find((event) => event.kind === 'sts-assume-web-identity')?.outcome,
      'denied',
    );
    assert.equal(
      webDenied.world.events.some((event) => event.kind === 'sts-assume-role'),
      false,
    );
    assert.equal(
      webDenied.world.events.some((event) => event.kind === 'cloud-object-read'),
      false,
    );

    const roleDenied = setup(seed + 800, family);
    permit(roleDenied.world);
    roleDenied.account.base_role.can_assume = [];
    const roleJob = submit(roleDenied.world, roleDenied.account, roleDenied.template);
    assert.equal(roleJob.ok, true);
    assert.equal(
      stepJob(roleDenied.world, { tool: 'run-job', args: { job_uid: roleJob.job_uid } }).reason,
      'role-assumption-denied',
    );
    assert.equal(
      roleDenied.world.events.find((event) => event.kind === 'sts-assume-web-identity')?.outcome,
      'completed',
    );
    assert.equal(
      roleDenied.world.events.find((event) => event.kind === 'sts-assume-role')?.outcome,
      'denied',
    );
    assert.equal(
      roleDenied.world.events.some((event) => event.kind === 'cloud-object-read'),
      false,
    );

    const iamDenied = setup(seed + 900, family);
    permit(iamDenied.world);
    iamDenied.account.dest_role.permissions = [];
    const iamJob = submit(iamDenied.world, iamDenied.account, iamDenied.template);
    assert.equal(iamJob.ok, true);
    assert.equal(
      stepJob(iamDenied.world, { tool: 'run-job', args: { job_uid: iamJob.job_uid } }).reason,
      'cloud-read-denied',
    );
    assert.equal(
      iamDenied.world.events.find((event) => event.kind === 'sts-assume-web-identity')?.outcome,
      'completed',
    );
    assert.equal(
      iamDenied.world.events.find((event) => event.kind === 'sts-assume-role')?.outcome,
      'completed',
    );
    assert.equal(
      iamDenied.world.events.find((event) => event.kind === 'cloud-object-read')?.outcome,
      'denied',
    );

    const deniedCatalog = setup(seed + 100, family);
    for (const brokenTemplate of deniedCatalog.world.templates.filter(
      (item) => item.id !== deniedCatalog.template.id,
    )) {
      const denied = setup(seed + 100, family);
      permit(denied.world);
      assert.equal(
        submit(denied.world, denied.account, brokenTemplate).reason,
        'admission-denied',
        `template ${brokenTemplate.id} must fail its admission control`,
      );
      assert.equal(
        submit(denied.world, denied.account, denied.template).reason,
        'submit-attempt-exhausted',
        'a denied create must also consume the attempt',
      );
      assert.equal(stepJob(denied.world, { tool: 'run-job', args: {} }).ok, false);
    }
    const wrongNamespace = setup(seed + 400, family);
    permit(wrongNamespace.world);
    assert.equal(
      submit(wrongNamespace.world, wrongNamespace.account, wrongNamespace.template, {
        namespace: 'other-namespace',
      }).reason,
      'create-denied',
    );
    assert.equal(
      submit(wrongNamespace.world, wrongNamespace.account, wrongNamespace.template).reason,
      'submit-attempt-exhausted',
    );
    const unknownAccount = setup(seed + 500, family);
    permit(unknownAccount.world);
    assert.equal(
      submit(unknownAccount.world, { id: 'missing-service-account' }, unknownAccount.template)
        .reason,
      'admission-denied',
    );
    assert.equal(
      submit(unknownAccount.world, unknownAccount.account, unknownAccount.template).reason,
      'submit-attempt-exhausted',
    );

    const wrongIdentity = setup(seed + 200, family);
    permit(wrongIdentity.world);
    const wrongAccount = wrongIdentity.world.serviceAccounts.find(
      (item) => !jobIdentityCanRead(item, wrongIdentity.world.policy.protected_target),
    );
    const wrongCreated = submit(wrongIdentity.world, wrongAccount, wrongIdentity.template);
    assert.equal(wrongCreated.ok, true, 'identity denial must happen at Job runtime');
    assert.equal(
      stepJob(wrongIdentity.world, {
        tool: 'run-job',
        args: { job_uid: wrongCreated.job_uid },
      }).status,
      'denied',
    );
    assert.equal(
      wrongIdentity.world.events.some((event) => event.kind === 'job-artifact-created'),
      false,
    );

    const unauthenticated = setup(seed + 300, family);
    assert.equal(
      submit(unauthenticated.world, unauthenticated.account, unauthenticated.template).reason,
      'create-denied',
    );
    assert.equal(
      submit(unauthenticated.world, unauthenticated.account, unauthenticated.template).reason,
      'submit-attempt-exhausted',
    );
  }
}

console.log('v5 Job action self-test passed');
