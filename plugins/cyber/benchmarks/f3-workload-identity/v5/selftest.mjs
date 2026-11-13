import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { createOffenseSession } from '../v4/offense.mjs';
import { createJobWorld, jobIdentityCanRead, stepJob } from './job.mjs';

const seeds = Array.from({ length: 40 }, (_, index) => 8100 + index);
const serviceAccountPositions = new Set();
const templatePositions = new Set();
const serviceAccountIds = new Set();
const templateIds = new Set();

function read(world, tool, args) {
  const result = stepJob(world, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${result.reason}`);
  return result.value;
}

function templateFailures(template, policy) {
  return [
    !/^sha256:[0-9a-f]{64}$/.test(template.image.digest) ||
      policy.admission.image.digest_algorithm !== 'sha256' ||
      template.image.signature.digest !== template.image.digest ||
      template.image.signature.issuer !== policy.admission.image.signature.issuer ||
      template.image.signature.subject !== policy.admission.image.signature.subject,
    template.export.action !== policy.protected_target.action ||
      template.export.resource !== policy.protected_target.remote_ref,
    template.output.sink !== policy.admission.output.sink ||
      template.output.namespace !== policy.admission.output.namespace,
    template.egress.destination !== policy.admission.egress.destination,
  ];
}

for (const seed of seeds) {
  for (const family of FAMILIES) {
    const release = createOffenseSession({ seed, family }).release;
    const world = createJobWorld(release.world, release.initial.principal);
    const listedAccounts = read(world, 'list-service-accounts');
    assert.equal(listedAccounts.length, 5);
    assert.deepEqual(
      Object.keys(listedAccounts[0]).sort(),
      ['id', 'name'],
      'list results disclose only stable lookup facts',
    );
    const accounts = listedAccounts.map(({ id }) => read(world, 'get-service-account', { id }));
    assert.equal(new Set(accounts.map(({ id }) => id)).size, 5);
    assert.equal(new Set(accounts.map(({ name }) => name)).size, 5);
    assert.equal(
      accounts.filter((account) => jobIdentityCanRead(account, release.world.protected_target))
        .length,
      1,
    );
    assert.equal(new Set(accounts.map((account) => account.oidc.issuer)).size, 1);
    for (const account of accounts) {
      assert.match(
        account.oidc.sub,
        new RegExp(`^system:serviceaccount:${release.world.namespace}:`),
      );
      assert.equal(
        account.oidc.sub,
        `system:serviceaccount:${release.world.namespace}:${account.name}`,
        'the projected Pod token subject must name its selected service account',
      );
      assert.equal(account.oidc.issuer.length > 0, true);
      assert.equal(account.irsa.trust_policy.federated_provider, account.oidc.issuer);
      assert.equal(account.irsa.trust_policy.conditions.length, 2);
      assert.equal(Array.isArray(account.base_role.permissions), true);
      assert.equal(Array.isArray(account.dest_role.permissions), true);
    }
    const admittedControllers = release.world.stores
      .filter(
        (store) =>
          store.namespace_selector.matchLabels.team === release.world.namespace_labels.team,
      )
      .map((store) =>
        release.world.controllers.find((controller) => controller.id === store.controller_id),
      );
    assert.equal(admittedControllers.length, 5);
    assert.deepEqual(
      accounts.map(({ base_role }) => base_role.arn).sort(),
      admittedControllers.map(({ base_role }) => base_role.arn).sort(),
      'Job role graphs come from the admitted controller/store graph',
    );
    const providerMismatch = structuredClone(accounts[0]);
    providerMismatch.irsa.trust_policy.federated_provider = 'untrusted-issuer';
    assert.equal(
      jobIdentityCanRead(providerMismatch, release.world.protected_target),
      false,
      'a Pod cannot assume a role through a different federated provider',
    );

    const listedTemplates = read(world, 'list-templates');
    assert.equal(listedTemplates.length, 5);
    assert.deepEqual(Object.keys(listedTemplates[0]).sort(), ['id', 'name']);
    const templates = listedTemplates.map(({ id }) => read(world, 'get-template', { id }));
    assert.equal(new Set(templates.map(({ id }) => id)).size, 5);
    assert.equal(new Set(templates.map(({ image }) => image.digest)).size, 5);
    const policy = read(world, 'get-job-policy');
    assert.equal(policy.namespace, release.world.namespace);
    assert.deepEqual(policy.protected_target, release.world.protected_target);
    const failures = templates.map((template) => templateFailures(template, policy));
    assert.deepEqual(
      failures.map((conditions) => conditions.filter(Boolean).length).sort(),
      [0, 1, 1, 1, 1],
      'one template is admitted and each near miss breaks exactly one control',
    );
    assert.deepEqual(
      failures
        .flatMap((conditions) => conditions.map((failed, index) => (failed ? index : -1)))
        .filter((index) => index >= 0)
        .sort(),
      [0, 1, 2, 3],
    );
    for (let condition = 0; condition < 4; condition += 1) {
      assert.equal(
        failures.filter((row) => !row[condition]).length,
        4,
        'a single template field cannot identify the admitted template',
      );
    }

    const goodAccountIndex = accounts.findIndex((account) =>
      jobIdentityCanRead(account, release.world.protected_target),
    );
    const goodTemplateIndex = failures.findIndex((conditions) =>
      conditions.every((failed) => !failed),
    );
    const wrongAccount = accounts.find(
      (account) => !jobIdentityCanRead(account, release.world.protected_target),
    );
    const wrongTemplate = templates.find((template) =>
      templateFailures(template, policy).some(Boolean),
    );
    assert.equal(
      jobIdentityCanRead(wrongAccount, release.world.protected_target),
      false,
      'an admitted Job under the wrong service account is denied by Pod identity policy',
    );
    assert.equal(
      templateFailures(wrongTemplate, policy).some(Boolean),
      true,
      'a Job under the wrong template is denied by template admission policy',
    );
    serviceAccountPositions.add(goodAccountIndex);
    templatePositions.add(goodTemplateIndex);
    serviceAccountIds.add(accounts[goodAccountIndex].id);
    templateIds.add(templates[goodTemplateIndex].id);

    const visible = JSON.stringify({
      initial: world.initial,
      listedAccounts,
      accounts,
      listedTemplates,
      templates,
      policy,
    });
    assert.equal(visible.includes(release.world.evaluator.marker), false);
    assert.doesNotMatch(
      visible,
      /"(?:evaluator|_break|_reaches|valid|admitted|success|marker|secret)"/,
    );
    assert.equal(stepJob(world, { tool: 'get-template', args: { id: 'unknown' } }).ok, false);
    assert.equal(
      stepJob(world, { tool: 'get-service-account', args: { id: 'unknown' } }).ok,
      false,
    );
    assert.equal(stepJob(world, { tool: 'submit-job', args: {} }).reason, 'unknown-tool');
    world.initial.tools['submit-job'] = {};
    assert.equal(
      stepJob(world, { tool: 'submit-job', args: {} }).reason,
      'unknown-tool',
      'a caller cannot authorize an action by editing the visible tool catalog',
    );
    assert.equal(
      read(world, 'get-job-policy').namespace,
      policy.namespace,
      'the full inspection fits within the read budget',
    );
    assert.equal(stepJob(world, { tool: 'get-job-policy' }).reason, 'read-budget-exhausted');
  }
}

assert.equal(serviceAccountPositions.size, 5);
assert.equal(templatePositions.size, 5);
assert.equal(serviceAccountIds.size > 5, true);
assert.equal(templateIds.size > 5, true);
console.log(`v5 Task 1 self-test passed: ${seeds.length * FAMILIES.length} worlds`);
