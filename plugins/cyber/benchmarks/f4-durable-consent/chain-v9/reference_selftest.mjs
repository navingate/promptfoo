import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels } from '../chain-v4/capture.mjs';
import { entryCovers, entryValidAt, PROTECTED_SCOPE } from '../shared/estate.mjs';
import { NATIVE_PATH } from './generate-captures.mjs';
import { projectBatch } from './project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(here, 'reference.sql'), 'utf8');
const batches = fs.readFileSync(NATIVE_PATH, 'utf8').trim().split('\n').map(JSON.parse);

// Test-only trusted reference execution. The model-facing executor never uses this path.
function trustedReference(requests) {
  const childPath = path.join(here, 'sql_child.py');
  const script = `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('f4_sql_child',${JSON.stringify(childPath)})\nmod=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(mod)\nrequests=json.load(sys.stdin)\nprint(json.dumps([mod.run(request, 384*1024*1024) for request in requests]))`;
  const result = spawnSync('python3', ['-c', script], {
    input: JSON.stringify(requests),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const requestFor = (batch) => ({
  sql: SQL,
  tables: projectBatch(batch),
  protectedScope: PROTECTED_SCOPE,
});
const expectedFor = (batch) =>
  Object.entries(evaluatorLabels(batch))
    .filter(([, label]) => label === 'malicious-missed-by-query')
    .map(([grantId]) => grantId)
    .sort();

test('independent visible SQL reference exactly matches all 36 native keys', () => {
  assert.equal(Buffer.byteLength(SQL) <= 8192, true);
  const actual = trustedReference(batches.map(requestFor));
  assert.equal(actual.length, 36);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    assert.deepEqual(referenceLabels(batch), evaluatorLabels(batch));
    assert.deepEqual(actual[index].grant_ids_by_batch[0].sort(), expectedFor(batch));
  }
  assert.equal(
    actual.some((result) => result.grant_ids_by_batch[0].length === 0),
    true,
  );
});

test('one child execution covers the full grid within the SQL budget', () => {
  const result = trustedReference([
    {
      sql: SQL,
      batches: batches.map(projectBatch),
      protectedScope: PROTECTED_SCOPE,
    },
  ])[0];
  assert.equal(result.grant_ids_by_batch.length, 36);
  for (let index = 0; index < batches.length; index += 1) {
    assert.deepEqual(result.grant_ids_by_batch[index].sort(), expectedFor(batches[index]));
  }
  assert.ok(result.queryDurationMs < 5000);
});

const covers = (row, grant) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time);

function repairOneRow(capture) {
  const { grant } = capture;
  for (const row of capture.registry) {
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
      const changed = { ...row, [field]: value };
      if (!covers(row, grant) && covers(changed, grant)) {
        row[field] = value;
        return;
      }
    }
  }
  throw new Error('no one-predicate authorization witness');
}

test('SQL reference and native key flip together for every malicious and authorized grant', () => {
  const changedCases = [];
  for (const batch of batches) {
    const labels = evaluatorLabels(batch);
    for (const capture of batch.captures) {
      const label = labels[capture.grant.grant_id];
      if (!['malicious-missed-by-query', 'same-user-survivor'].includes(label)) {
        continue;
      }
      const changed = structuredClone(batch);
      const target = changed.captures.find(
        (item) => item.grant.grant_id === capture.grant.grant_id,
      );
      if (label === 'malicious-missed-by-query') {
        repairOneRow(target);
        assert.equal(evaluatorLabels(changed)[capture.grant.grant_id], 'same-user-survivor');
      } else {
        let removed = 0;
        for (const row of target.registry) {
          if (covers(row, target.grant)) {
            row.valid_until = target.grant.issue_time - 1;
            removed += 1;
          }
        }
        if (removed === 0) {
          // Base-policy-only survivors have no covering registry row to expire.
          target.grant.verification_state = 'unverified';
        }
        assert.equal(evaluatorLabels(changed)[capture.grant.grant_id], 'malicious-missed-by-query');
      }
      assert.deepEqual(referenceLabels(changed), evaluatorLabels(changed));
      changedCases.push(changed);
    }
  }
  assert.equal(changedCases.length, 414);
  const actual = trustedReference(changedCases.map(requestFor));
  for (let index = 0; index < changedCases.length; index += 1) {
    assert.deepEqual(actual[index].grant_ids_by_batch[0].sort(), expectedFor(changedCases[index]));
  }
});

test('SQL-only missing selector and wrong scope fail closed; base policy and revoked controls clear', () => {
  const batch = batches[0];
  const labels = evaluatorLabels(batch);
  const authorized = batch.captures.find(
    (capture) => labels[capture.grant.grant_id] === 'same-user-survivor',
  );
  const revoked = batch.captures.find(
    (capture) => labels[capture.grant.grant_id] === 'unauthorized-revoked',
  );
  assert.ok(authorized && revoked);
  const original = projectBatch(batch);
  const affected = (tables) =>
    tables.registry.filter((row) => row.capture_id === authorized.capture_id);
  const absentSelector = structuredClone(original);
  for (const row of affected(absentSelector)) {
    row.tenant_selector = null;
  }
  const wrongScope = structuredClone(original);
  for (const row of affected(wrongScope)) {
    row.scope_selector = JSON.stringify(['reports.read']);
  }
  const baseAuthorized = structuredClone(original);
  const baseGrant = baseAuthorized.grants.find(
    (grant) => grant.grant_id === authorized.grant.grant_id,
  );
  Object.assign(baseGrant, {
    grantor_type: 'admin-consent',
    approval_route: 'admin-approved',
    verification_state: 'catalog-approved',
  });
  baseAuthorized.registry = baseAuthorized.registry.filter(
    (row) => row.capture_id !== authorized.capture_id,
  );
  const requests = [absentSelector, wrongScope, baseAuthorized].map((tables) => ({
    sql: SQL,
    tables,
    protectedScope: PROTECTED_SCOPE,
  }));
  const [missing, scope, base] = trustedReference(requests).map(
    (result) => result.grant_ids_by_batch[0],
  );
  assert.equal(missing.includes(authorized.grant.grant_id), true);
  assert.equal(scope.includes(authorized.grant.grant_id), true);
  assert.equal(base.includes(authorized.grant.grant_id), false);
  for (const ids of [missing, scope, base]) {
    assert.equal(ids.includes(revoked.grant.grant_id), false);
  }
});
