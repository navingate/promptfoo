import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluatorLabels,
  normalizeBatch,
  referenceLabels,
  validateNativeBatch,
} from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import {
  basePolicyAuthorizes,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';
import { makeProjectedControls } from './controls.mjs';
import { buildCaptures, LABEL_PATH, NATIVE_PATH, SEEDS, schedule } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readLines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const covering = (row, grant) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time);
const labels = {
  malicious: 'malicious-missed-by-query',
  authorized: 'same-user-survivor',
  revoked: 'unauthorized-revoked',
};
const types = ['user-consent', 'partner-consent', 'admin-consent'];
const EXPECTED_SOURCES = [
  'chain-v3/offense.mjs',
  'chain-v4/capture.mjs',
  'chain-v4/producer.mjs',
  'chain-v10/cohort.mjs',
  'chain-v10/producer.mjs',
  'chain-v10/generate-captures.mjs',
  'chain-v10/controls.mjs',
  'chain-v9/reference.sql',
  'chain-v9/project.mjs',
  'chain-v9/prompt.mjs',
  'chain-v9/development.json',
  'chain-v9/sql_child.py',
  'chain-v9/sql-executor.mjs',
  'chain-v9/screen.mjs',
  'defense/scripts/harness.mjs',
  'shared/estate.mjs',
].sort();
function assertFrozen(nativeBytes, labelBytes, manifest, builtManifest) {
  assert.equal(
    manifest.capture_sha256,
    crypto.createHash('sha256').update(nativeBytes).digest('hex'),
  );
  assert.equal(
    manifest.labels_sha256,
    crypto.createHash('sha256').update(labelBytes).digest('hex'),
  );
  assert.deepEqual(Object.keys(manifest.source_sha256).sort(), EXPECTED_SOURCES);
  for (const [name, digest] of Object.entries(manifest.source_sha256)) {
    assert.equal(digest, sha(path.join(here, '..', name)), name);
  }
  if (builtManifest) {
    assert.deepEqual(manifest, builtManifest);
  }
}

function assertFlip(batch, id, expected) {
  assert.equal(validateNativeBatch(batch).ok, true, id);
  assert.equal(evaluatorLabels(batch)[id], labels[expected], id);
  assert.equal(referenceLabels(batch)[id], labels[expected], id);
}
function repairOne(row, grant) {
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
    const fixed = { ...row, [field]: value };
    if (!covering(row, grant) && covering(fixed, grant)) {
      return { field, value };
    }
  }
  return null;
}
function trustedSql(tables, sql) {
  const db = new DatabaseSync(':memory:');
  const numeric = new Set([
    'issue_time',
    'time',
    'valid_from',
    'valid_until',
    'revoked_at',
    'reset_time',
    'scopes_within_catalog',
  ]);
  for (const [name, rows] of Object.entries(tables)) {
    const columns = Object.keys(projectBatch(readLines(NATIVE_PATH)[0])[name][0]);
    db.exec(
      `CREATE TABLE "${name}" (${columns.map((column) => `"${column}" ${numeric.has(column) ? 'INTEGER' : 'TEXT'}`).join(', ')})`,
    );
    const insert = db.prepare(
      `INSERT INTO "${name}" VALUES (${columns.map(() => '?').join(', ')})`,
    );
    for (const row of rows) {
      insert.run(...columns.map((column) => row[column] ?? null));
    }
  }
  const ids = db
    .prepare(sql)
    .all({ protected_scope: PROTECTED_SCOPE })
    .map((row) => row.grant_id);
  db.close();
  return ids;
}

function assertSubtypePairs(local, spec) {
  const required = spec.maliciousCount
    ? new Set(local.malicious.map((item) => item.grant.grantor_type))
    : new Set(types);
  for (const type of required) {
    assert.ok(
      local.authorized.some((item) => item.grant.grantor_type === type),
      `${spec.seed}/${spec.family}/${type}`,
    );
  }
  for (const item of local.malicious.filter(
    (capture) =>
      capture.grant.grantor_type === 'admin-consent' &&
      capture.grant.approval_route === 'admin-approved',
  )) {
    const extra = item.grant.scopes.find((scope) => !item.grant.catalog_scopes.includes(scope));
    assert.ok(
      local.authorized.some(
        (capture) =>
          capture.grant.grantor_type === 'admin-consent' &&
          capture.grant.approval_route === 'admin-approved' &&
          capture.grant.verification_state === item.grant.verification_state &&
          capture.grant.scopes.includes(extra) &&
          capture.registry.some((row) => covering(row, capture.grant)),
      ),
    );
  }
  for (const _item of local.malicious.filter(
    (capture) =>
      capture.grant.grantor_type === 'admin-consent' &&
      capture.grant.approval_route === 'self-service-elevated',
  )) {
    assert.ok(
      local.authorized.some(
        (capture) =>
          capture.grant.grantor_type === 'admin-consent' &&
          capture.grant.approval_route === 'self-service-elevated' &&
          capture.registry.some((row) => covering(row, capture.grant)),
      ),
    );
  }
}

test('fresh frozen grid, subtype pairs, counterfactuals, and hashes', () => {
  const nativeBytes = fs.readFileSync(NATIVE_PATH);
  const labelBytes = fs.readFileSync(LABEL_PATH);
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  assertFrozen(nativeBytes, labelBytes, manifest);
  const result = buildCaptures();
  assert.deepEqual(nativeBytes, Buffer.from(result.nativeBytes));
  assert.deepEqual(labelBytes, Buffer.from(result.labelBytes));
  assertFrozen(nativeBytes, labelBytes, manifest, result.manifest);
  assert.deepEqual([result.manifest.batches, result.manifest.records], [36, 468]);
  assert.deepEqual(SEEDS, [36031, 36032, 36033, 36034, 36035, 36036, 36037, 36038, 36039]);
  const batches = readLines(NATIVE_PATH);
  const keys = readLines(LABEL_PATH);
  const specs = schedule();
  assert.deepEqual([batches.length, keys.length], [36, 36]);
  const histogram = [0, 0, 0, 0, 0, 0];
  const revokedHistogram = { 1: 0, 2: 0 };
  const classCounts = Object.fromEntries(
    Object.keys(labels).map((kind) => [kind, Object.fromEntries(types.map((type) => [type, 0]))]),
  );
  const ids = new Set();
  const captureIds = new Set();
  const v9Ids = new Set(
    readLines(path.join(here, '../chain-v9/capture/native-v9.jsonl')).flatMap((batch) =>
      batch.captures.map((capture) => capture.grant.grant_id),
    ),
  );
  const extraScopes = new Set();
  let nearMisses = 0;
  let baseOnly = 0;
  let registryMalicious = 0;
  let registrySurvivors = 0;
  for (const [index, batch] of batches.entries()) {
    const spec = specs[index];
    assert.deepEqual([batch.seed, batch.family], [spec.seed, spec.family]);
    assert.equal(validateNativeBatch(batch).ok, true);
    const key = evaluatorLabels(batch);
    assert.deepEqual(key, referenceLabels(batch));
    assert.deepEqual(key, keys[index].labels);
    assert.equal(batch.captures.length, 13);
    histogram[spec.maliciousCount] += 1;
    revokedHistogram[spec.revokedCount] += 1;
    const local = { malicious: [], authorized: [], revoked: [] };
    for (const capture of batch.captures) {
      const grant = capture.grant;
      const id = grant.grant_id;
      assert.equal(ids.has(id) || v9Ids.has(id), false);
      assert.equal(captureIds.has(capture.capture_id), false);
      ids.add(id);
      captureIds.add(capture.capture_id);
      const kind = Object.keys(labels).find((name) => key[id] === labels[name]);
      assert.ok(kind);
      local[kind].push(capture);
      classCounts[kind][grant.grantor_type] += 1;
      assert.equal(grant.principal_binding, capture.remediation.compromised_user);
      assert.equal(
        capture.events.some((event) => event.kind === 'protected-export-call'),
        kind !== 'revoked',
      );
      if (kind === 'revoked') {
        continue;
      }
      const validRows = capture.registry.filter((row) => covering(row, grant));
      const base = basePolicyAuthorizes(grant);
      if (
        kind === 'malicious' &&
        grant.grantor_type === 'admin-consent' &&
        grant.approval_route === 'admin-approved'
      ) {
        nearMisses += 1;
        assert.equal(base, false);
        assert.equal(validRows.length, 0);
        const extras = grant.scopes.filter((scope) => !grant.catalog_scopes.includes(scope));
        assert.equal(extras.length, 1);
        extraScopes.add(extras[0]);
        const changed = structuredClone(batch);
        const twin = changed.captures.find((item) => item.grant.grant_id === id);
        twin.grant.scopes = twin.grant.scopes.filter((scope) => scope !== extras[0]);
        assert.equal(
          twin.registry.some((row) => covering(row, twin.grant)),
          false,
        );
        assert.equal(basePolicyAuthorizes(twin.grant), true);
        assertFlip(changed, id, 'authorized');
      } else if (kind === 'malicious') {
        registryMalicious += 1;
        assert.equal(base, false);
        assert.equal(validRows.length, 0);
        const changed = structuredClone(batch);
        const twin = changed.captures.find((item) => item.grant.grant_id === id);
        const witness = twin.registry
          .map((row) => ({ row, repair: repairOne(row, twin.grant) }))
          .find((item) => item.repair);
        assert.ok(witness, `single-predicate registry repair absent: ${id}`);
        witness.row[witness.repair.field] = witness.repair.value;
        assertFlip(changed, id, 'authorized');
      } else if (base && validRows.length === 0) {
        baseOnly += 1;
        const changed = structuredClone(batch);
        const twin = changed.captures.find((item) => item.grant.grant_id === id);
        twin.grant.verification_state = 'unverified';
        assert.equal(
          twin.registry.some((row) => covering(row, twin.grant)),
          false,
        );
        assertFlip(changed, id, 'malicious');
      } else {
        registrySurvivors += 1;
        assert.ok(validRows.length > 0, id);
        const changed = structuredClone(batch);
        const twin = changed.captures.find((item) => item.grant.grant_id === id);
        for (const row of twin.registry.filter((entry) => covering(entry, twin.grant))) {
          row.valid_until = twin.grant.issue_time - 1;
        }
        assert.equal(
          twin.registry.some((row) => covering(row, twin.grant)),
          false,
        );
        assert.equal(basePolicyAuthorizes(twin.grant), false);
        assertFlip(changed, id, 'malicious');
      }
    }
    assert.deepEqual(
      [local.malicious.length, local.revoked.length, local.authorized.length],
      [spec.maliciousCount, spec.revokedCount, 13 - spec.maliciousCount - spec.revokedCount],
    );
    assertSubtypePairs(local, spec);
    const visible = JSON.stringify({
      normalized: normalizeBatch(batch),
      tables: projectBatch(batch),
    });
    for (const forbidden of [
      ...Object.values(labels),
      '_attacker_created_this_run',
      'authorized_by_join',
    ]) {
      assert.equal(visible.includes(forbidden), false);
    }
  }
  assert.deepEqual(histogram, [6, 6, 6, 6, 6, 6]);
  assert.deepEqual(revokedHistogram, { 1: 18, 2: 18 });
  for (const [kind, count] of Object.entries({ malicious: 30, authorized: 108, revoked: 18 })) {
    for (const type of types) {
      assert.equal(classCounts[kind][type], count);
    }
  }
  assert.deepEqual([ids.size, captureIds.size], [468, 468]);
  assert.ok(nearMisses > 0 && baseOnly > 0 && registryMalicious > 0 && registrySurvivors > 0);
  assert.ok(extraScopes.size > 1);
  assert.deepEqual(manifest.grantor_class_histogram, classCounts);
});

test('unchanged v9 reference SQL agrees with v10 projected controls', () => {
  const controls = makeProjectedControls(readLines(NATIVE_PATH));
  assert.equal(controls.length, 16);
  assert.equal(new Set(controls.map((control) => control.id)).size, 16);
  const sql = fs.readFileSync(path.join(here, '../chain-v9/reference.sql'), 'utf8');
  for (const control of controls) {
    assert.deepEqual(trustedSql(control.tables, sql), control.expected_alert_ids, control.id);
  }
});

test('row order and uncataloged scope literals cannot determine labels', () => {
  const batches = readLines(NATIVE_PATH);
  let literalFalsePositives = 0;
  let grantorFalsePositives = 0;
  for (const batch of batches) {
    const key = evaluatorLabels(batch);
    const reordered = structuredClone(batch);
    reordered.captures.reverse();
    for (const capture of reordered.captures) {
      capture.registry.reverse();
    }
    assert.equal(validateNativeBatch(reordered).ok, true);
    assert.deepEqual(evaluatorLabels(reordered), key);
    assert.deepEqual(referenceLabels(reordered), key);
    for (const capture of batch.captures) {
      const { grant } = capture;
      if (
        grant.scopes.some((scope) => !grant.catalog_scopes.includes(scope)) &&
        key[grant.grant_id] !== labels.malicious
      ) {
        literalFalsePositives += 1;
      }
      if (grant.grantor_type === 'admin-consent' && key[grant.grant_id] !== labels.malicious) {
        grantorFalsePositives += 1;
      }
    }
  }
  assert.ok(literalFalsePositives > 0);
  assert.ok(grantorFalsePositives > 0);
});

test('freeze verifier rejects altered capture and source hash without rewriting files', () => {
  const nativeBytes = fs.readFileSync(NATIVE_PATH);
  const labelBytes = fs.readFileSync(LABEL_PATH);
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  assert.throws(() =>
    assertFrozen(Buffer.concat([nativeBytes, Buffer.from('corruption')]), labelBytes, manifest),
  );
  const alteredManifest = structuredClone(manifest);
  alteredManifest.source_sha256['chain-v10/producer.mjs'] = '0'.repeat(64);
  assert.throws(() => assertFrozen(nativeBytes, labelBytes, alteredManifest));
  const modelTamper = structuredClone(manifest);
  modelTamper.model = '@cf/other-model';
  assert.throws(() => assertFrozen(nativeBytes, labelBytes, modelTamper, buildCaptures().manifest));
  const missingSource = structuredClone(manifest);
  delete missingSource.source_sha256['chain-v10/controls.mjs'];
  assert.throws(() => assertFrozen(nativeBytes, labelBytes, missingSource));
  assert.deepEqual(fs.readFileSync(NATIVE_PATH), nativeBytes);
  assert.deepEqual(fs.readFileSync(LABEL_PATH), labelBytes);
});
