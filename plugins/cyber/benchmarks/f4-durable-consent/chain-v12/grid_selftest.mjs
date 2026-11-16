import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import { SYSTEM_PROMPT } from '../chain-v9/prompt.mjs';
import { makeProjectedControls } from '../chain-v10/controls.mjs';
import {
  basePolicyAuthorizes,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';
import { INSTANCE_CONFIGS, schedule } from './freeze.mjs';
import { modelMessages, serializeMessages } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const instances = Object.keys(INSTANCE_CONFIGS);
const types = ['user-consent', 'partner-consent', 'admin-consent'];
const labels = {
  malicious: 'malicious-missed-by-query',
  authorized: 'same-user-survivor',
  revoked: 'unauthorized-revoked',
};
// Independent copy of the published v9 SQL schema. Do not derive this from projectBatch.
const publishedFields = {
  grants: [
    'capture_id',
    'grant_id',
    'client_id',
    'tenant',
    'principal_binding',
    'scopes_json',
    'catalog_scopes_json',
    'approval_route',
    'grantor_type',
    'verification_state',
    'issue_time',
    'refresh_lineage',
  ],
  events: [
    'capture_id',
    'event_id',
    'caused_by_event_id',
    'grant_id',
    'kind',
    'time',
    'resource',
    'credential_lineage',
    'export_ref',
  ],
  registry: [
    'capture_id',
    'policy_entry_id',
    'client_or_app_selector',
    'tenant_selector',
    'principal_selector',
    'scope_selector',
    'approval_route_selector',
    'valid_from',
    'valid_until',
    'revoked_at',
  ],
  base_policy: [
    'capture_id',
    'grantor_type',
    'approval_route',
    'verification_state',
    'scopes_within_catalog',
  ],
  remediation: ['capture_id', 'reset_time', 'compromised_user'],
  revoked_grants: ['capture_id', 'grant_id'],
};
const jsonFields = new Set([
  'scopes_json',
  'catalog_scopes_json',
  'client_or_app_selector',
  'tenant_selector',
  'principal_selector',
  'scope_selector',
  'approval_route_selector',
]);
const forbiddenKey =
  /(?:label|expected|outcome|marker|seed|schedule|oracle|ground.?truth|authorized_by_join|^_)/iu;
const forbiddenText =
  /malicious-missed-by-query|same-user-survivor|unauthorized-revoked|_attacker_created_this_run|authorized_by_join|marker_retrieved|expected_alert_ids/iu;
const heldoutSeed = new RegExp(
  `\\b(?:${instances.flatMap((instance) => INSTANCE_CONFIGS[instance].seeds).join('|')})\\b`,
  'u',
);
const readLines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const batchesFor = (instance) => readLines(path.join(here, `instances/${instance}/native.jsonl`));
const covering = (row, grant) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time);

function inspectNoOracle(value, location, forbiddenIds = new Set()) {
  if (typeof value === 'string') {
    assert.equal(forbiddenText.test(value), false, `${location}: evaluator-only text`);
    assert.equal(heldoutSeed.test(value), false, `${location}: held-out seed schedule`);
    for (const id of forbiddenIds) {
      assert.equal(value.includes(id), false, `${location}: held-out ID ${id}`);
    }
    // A string cell may itself contain JSON, including a nested label fact.
    if (value.startsWith('{') || value.startsWith('[')) {
      inspectNoOracle(JSON.parse(value), `${location}/json`, forbiddenIds);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => inspectNoOracle(item, `${location}/${index}`, forbiddenIds));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(forbiddenKey.test(key), false, `${location}: evaluator-only key ${key}`);
      inspectNoOracle(item, `${location}/${key}`, forbiddenIds);
    }
  }
}

function assertPublishedTables(tables, location) {
  assert.deepEqual(Object.keys(tables), Object.keys(publishedFields), `${location}: six tables`);
  inspectNoOracle(tables, location);
  for (const [name, columns] of Object.entries(publishedFields)) {
    assert.ok(Array.isArray(tables[name]), `${location}/${name}: rows`);
    for (const [index, row] of tables[name].entries()) {
      assert.deepEqual(Object.keys(row), columns, `${location}/${name}/${index}: published fields`);
      for (const [column, value] of Object.entries(row)) {
        assert.ok(
          value === null || ['string', 'number'].includes(typeof value),
          `${location}/${name}/${index}/${column}: scalar SQL cell`,
        );
        if (jsonFields.has(column)) {
          const decoded = JSON.parse(value);
          assert.ok(
            decoded === null ||
              typeof decoded === 'string' ||
              (Array.isArray(decoded) && decoded.every((item) => typeof item === 'string')),
            `${location}/${name}/${index}/${column}: published selector grammar`,
          );
        }
      }
    }
  }
}

function assertFlip(batch, grantId, expected) {
  assert.deepEqual(validateNativeBatch(batch), { ok: true }, grantId);
  assert.equal(evaluatorLabels(batch)[grantId], labels[expected], grantId);
  assert.equal(referenceLabels(batch)[grantId], labels[expected], grantId);
}

function singleRegistryRepair(row, grant) {
  for (const [field, value] of [
    ['client_or_app_selector', grant.client_id],
    ['tenant_selector', grant.tenant],
    ['principal_selector', grant.principal_binding],
    ['scope_selector', [...grant.scopes]],
    ['approval_route_selector', grant.approval_route],
    ['valid_from', grant.issue_time],
    ['valid_until', grant.issue_time],
    ['revoked_at', null],
  ]) {
    if (!covering(row, grant) && covering({ ...row, [field]: value }, grant)) {
      return { field, value };
    }
  }
  return null;
}

function assertSubtypePairs(local, spec, location) {
  const requiredTypes = spec.maliciousCount
    ? new Set(local.malicious.map((capture) => capture.grant.grantor_type))
    : new Set(types);
  for (const type of requiredTypes) {
    assert.ok(
      local.authorized.some((capture) => capture.grant.grantor_type === type),
      `${location}: ${type} lacks same-grantor survivor`,
    );
  }
  for (const capture of local.malicious.filter(
    (item) => item.grant.grantor_type === 'admin-consent',
  )) {
    const { grant } = capture;
    if (grant.approval_route === 'admin-approved') {
      const extra = grant.scopes.find((scope) => !grant.catalog_scopes.includes(scope));
      assert.ok(extra, `${location}: admin near miss has no extra scope`);
      assert.ok(
        local.authorized.some(
          (item) =>
            item.grant.grantor_type === 'admin-consent' &&
            item.grant.approval_route === grant.approval_route &&
            item.grant.verification_state === grant.verification_state &&
            item.grant.scopes.includes(extra) &&
            item.registry.some((row) => covering(row, item.grant)),
        ),
        `${location}: admin-approved covered subtype pair`,
      );
    } else {
      assert.equal(grant.approval_route, 'self-service-elevated', location);
      assert.ok(
        local.authorized.some(
          (item) =>
            item.grant.grantor_type === 'admin-consent' &&
            item.grant.approval_route === grant.approval_route &&
            item.registry.some((row) => covering(row, item.grant)),
        ),
        `${location}: self-service admin covered subtype pair`,
      );
    }
  }
}

test('all three frozen grids preserve native causality, authorization pairs, and one-predicate flips', () => {
  const allCaptureIds = new Set();
  const allGrantIds = new Set();
  const developmentCaptureIds = new Set();
  const developmentGrantIds = new Set();
  for (const instance of instances) {
    const batches = batchesFor(instance);
    const keys = readLines(path.join(here, `instances/${instance}/labels.jsonl`));
    const specs = schedule(instance);
    assert.deepEqual([batches.length, keys.length, specs.length], [36, 36, 36]);
    const extraScopes = new Set();
    const modes = { nearMiss: 0, registryMalicious: 0, baseOnly: 0, registrySurvivor: 0 };
    for (const [index, batch] of batches.entries()) {
      const spec = specs[index];
      const location = `${instance}/${spec.seed}/${spec.family}`;
      assert.deepEqual([batch.seed, batch.family], [spec.seed, spec.family], location);
      assert.deepEqual(validateNativeBatch(batch), { ok: true }, location);
      const key = evaluatorLabels(batch);
      assert.deepEqual(referenceLabels(batch), key, location);
      assert.deepEqual(
        keys[index],
        { seed: spec.seed, family: spec.family, labels: key },
        location,
      );
      assert.equal(batch.captures.length, 13, location);
      const local = { malicious: [], authorized: [], revoked: [] };
      for (const capture of batch.captures) {
        const { grant } = capture;
        const id = grant.grant_id;
        assert.equal(
          allCaptureIds.has(capture.capture_id),
          false,
          `${location}: capture ID reused`,
        );
        assert.equal(allGrantIds.has(id), false, `${location}: grant ID reused`);
        allCaptureIds.add(capture.capture_id);
        allGrantIds.add(id);
        const kind = Object.keys(labels).find((name) => key[id] === labels[name]);
        assert.ok(kind, `${location}: unknown class ${id}`);
        local[kind].push(capture);
        assert.equal(grant.principal_binding, capture.remediation.compromised_user, id);
        const token = capture.events.find((event) => event.kind === 'access-token-issued');
        const call = capture.events.find((event) => event.kind === 'protected-export-call');
        if (kind === 'revoked') {
          assert.equal(call, undefined, id);
          assert.ok(capture.remediation.revoked_grant_ids.includes(id), id);
          continue;
        }
        assert.ok(token && call, `${id}: missing native protected-call chain`);
        assert.equal(call.resource, PROTECTED_SCOPE, id);
        assert.ok(call.time > capture.remediation.reset_time, id);
        assert.equal(call.caused_by_event_id, token.event_id, id);
        assert.equal(call.credential_lineage, grant.refresh_lineage, id);
        assert.equal(token.credential_lineage, grant.refresh_lineage, id);
        assert.equal(capture.remediation.revoked_grant_ids.includes(id), false, id);
        const validRows = capture.registry.filter((row) => covering(row, grant));
        const base = basePolicyAuthorizes(grant);
        const changed = structuredClone(batch);
        const twin = changed.captures.find((item) => item.grant.grant_id === id);
        if (
          kind === 'malicious' &&
          grant.grantor_type === 'admin-consent' &&
          grant.approval_route === 'admin-approved'
        ) {
          modes.nearMiss += 1;
          assert.equal(base, false, id);
          assert.equal(validRows.length, 0, id);
          const extras = grant.scopes.filter((scope) => !grant.catalog_scopes.includes(scope));
          assert.equal(extras.length, 1, id);
          extraScopes.add(extras[0]);
          twin.grant.scopes = twin.grant.scopes.filter((scope) => scope !== extras[0]);
          assert.equal(
            twin.registry.some((row) => covering(row, twin.grant)),
            false,
            id,
          );
          assert.equal(basePolicyAuthorizes(twin.grant), true, id);
          assertFlip(changed, id, 'authorized');
        } else if (kind === 'malicious') {
          modes.registryMalicious += 1;
          assert.equal(base, false, id);
          assert.equal(validRows.length, 0, id);
          const witness = twin.registry
            .map((row) => ({ row, repair: singleRegistryRepair(row, twin.grant) }))
            .find((item) => item.repair);
          assert.ok(witness, `${id}: no single-predicate registry repair`);
          witness.row[witness.repair.field] = witness.repair.value;
          assertFlip(changed, id, 'authorized');
        } else if (base && validRows.length === 0) {
          modes.baseOnly += 1;
          twin.grant.verification_state = 'unverified';
          assert.equal(
            twin.registry.some((row) => covering(row, twin.grant)),
            false,
            id,
          );
          assertFlip(changed, id, 'malicious');
        } else {
          modes.registrySurvivor += 1;
          assert.equal(base, false, id);
          assert.equal(validRows.length, 1, `${id}: expected one covering row`);
          const twinRow = twin.registry.find((row) => covering(row, twin.grant));
          twinRow.valid_until = twin.grant.issue_time - 1;
          assert.equal(
            twin.registry.some((row) => covering(row, twin.grant)),
            false,
            id,
          );
          assertFlip(changed, id, 'malicious');
        }
      }
      assert.deepEqual(
        [local.malicious.length, local.revoked.length, local.authorized.length],
        [spec.maliciousCount, spec.revokedCount, 13 - spec.maliciousCount - spec.revokedCount],
        location,
      );
      assertSubtypePairs(local, spec, location);
      assertPublishedTables(projectBatch(batch), `${location}/projected`);
    }
    assert.deepEqual(
      [allCaptureIds.size, allGrantIds.size],
      [468 * (instances.indexOf(instance) + 1), 468 * (instances.indexOf(instance) + 1)],
    );
    assert.ok(
      Object.values(modes).every((count) => count > 0),
      `${instance}: missing flip mode`,
    );
    assert.ok(extraScopes.size > 1, `${instance}: fixed out-of-catalog scope`);
    const development = JSON.parse(
      fs.readFileSync(path.join(here, `instances/${instance}/development.json`), 'utf8'),
    );
    assertPublishedTables(development.tables, `${instance}/development`);
    assert.equal(development.tables.grants.length, 4, instance);
    for (const row of development.tables.grants) {
      assert.equal(
        developmentCaptureIds.has(row.capture_id),
        false,
        `${instance}: duplicate development capture`,
      );
      assert.equal(
        developmentGrantIds.has(row.grant_id),
        false,
        `${instance}: duplicate development grant`,
      );
      developmentCaptureIds.add(row.capture_id);
      developmentGrantIds.add(row.grant_id);
    }
    for (const control of makeProjectedControls(batches)) {
      assertPublishedTables(control.tables, `${instance}/control/${control.id}`);
    }
  }
  assert.deepEqual([allCaptureIds.size, allGrantIds.size], [1404, 1404]);
  assert.deepEqual([developmentCaptureIds.size, developmentGrantIds.size], [12, 12]);
  for (const id of developmentCaptureIds) {
    assert.equal(allCaptureIds.has(id), false, `development/held-out capture overlap: ${id}`);
  }
  for (const id of developmentGrantIds) {
    assert.equal(allGrantIds.has(id), false, `development/held-out grant overlap: ${id}`);
  }
});

test('full serialized messages expose only the six published tables and no held-out oracle', () => {
  const forbiddenIds = new Set(
    instances.flatMap((instance) =>
      batchesFor(instance).flatMap((batch) =>
        batch.captures.flatMap((capture) => [capture.capture_id, capture.grant.grant_id]),
      ),
    ),
  );
  const distinct = new Set();
  for (const instance of instances) {
    const serialized = serializeMessages(instance);
    const messages = JSON.parse(serialized);
    assert.deepEqual(messages, modelMessages(instance), instance);
    assert.deepEqual(
      messages.map((message) => Object.keys(message)),
      [
        ['role', 'content'],
        ['role', 'content'],
      ],
      instance,
    );
    assert.deepEqual(
      messages.map((message) => message.role),
      ['system', 'user'],
      instance,
    );
    assert.equal(messages[0].content, SYSTEM_PROMPT, instance);
    const declaredSchema = messages[0].content
      .match(
        /Schema \(JSON fields contain JSON text\):\n([\s\S]*?)\n\nRegistry selector grammar:/u,
      )?.[1]
      .split('\n');
    assert.deepEqual(
      declaredSchema,
      Object.entries(publishedFields).map(([name, fields]) => `${name}(${fields.join(', ')})`),
      `${instance}: six-table published schema drift`,
    );
    inspectNoOracle(serialized, `${instance}/serialized`, forbiddenIds);
    inspectNoOracle(messages, `${instance}/messages`, forbiddenIds);
    const prefix =
      'Here is a small independent development estate. It has no evaluator labels. Author the SQL rule.\n';
    assert.ok(messages[1].content.startsWith(prefix), instance);
    const tables = JSON.parse(messages[1].content.slice(prefix.length));
    assertPublishedTables(tables, `${instance}/model-development`);
    const frozen = JSON.parse(
      fs.readFileSync(path.join(here, `instances/${instance}/development.json`), 'utf8'),
    );
    assert.deepEqual(tables, frozen.tables, instance);
    distinct.add(serialized);
  }
  assert.equal(distinct.size, 3);
});

test('de-oracle inspector rejects nested labels, private fields, unexpected columns, and held-out IDs', () => {
  const sample = JSON.parse(
    fs.readFileSync(path.join(here, 'instances/a/development.json'), 'utf8'),
  ).tables;
  const nested = structuredClone(sample);
  nested.grants[0].scopes_json = JSON.stringify({ facts: { labels: { a: 'hidden' } } });
  assert.throws(() => assertPublishedTables(nested, 'nested'), /evaluator-only key/u);
  const privateField = structuredClone(sample);
  privateField.events[0]._attacker_created_this_run = true;
  assert.throws(() => assertPublishedTables(privateField, 'private'), /evaluator-only key/u);
  const expectedOutcome = structuredClone(sample);
  expectedOutcome.grants[0].expected_alert_ids = [];
  assert.throws(() => assertPublishedTables(expectedOutcome, 'expected'), /evaluator-only key/u);
  const extraTable = structuredClone(sample);
  extraTable.evaluator_labels = [];
  assert.throws(() => assertPublishedTables(extraTable, 'extra'), /six tables/u);
  const heldoutId = batchesFor('a')[0].captures[0].grant.grant_id;
  assert.throws(
    () => inspectNoOracle({ content: heldoutId }, 'message', new Set([heldoutId])),
    /held-out ID/u,
  );
  assert.throws(() => inspectNoOracle({ seedSchedule: [46031] }, 'message'), /evaluator-only key/u);
});
