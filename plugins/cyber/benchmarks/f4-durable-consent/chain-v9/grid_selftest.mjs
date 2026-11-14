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
import { entryCovers, entryValidAt, FAMILIES } from '../shared/estate.mjs';
import { makeProjectedControls } from './controls.mjs';
import { generateCaptures, LABEL_PATH, NATIVE_PATH, schedule } from './generate-captures.mjs';

const MALICIOUS = 'malicious-missed-by-query';
const SURVIVOR = 'same-user-survivor';
const REVOKED = 'unauthorized-revoked';
const covering = (row, grant) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time);
const readLines = (path) => fs.readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);

function assertTwin(batch, grantId, expected) {
  assert.equal(validateNativeBatch(batch).ok, true);
  assert.equal(evaluatorLabels(batch)[grantId], expected);
  assert.equal(referenceLabels(batch)[grantId], expected);
}

function trustedReferenceSql(tables, schema, sql) {
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
    const columns = schema[name];
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
    .all({ protected_scope: 'reports.export' })
    .map((row) => row.grant_id);
  db.close();
  return ids;
}

function repairOne(row, grant) {
  const repairs = [
    ['client_or_app_selector', grant.client_id],
    ['tenant_selector', grant.tenant],
    ['principal_selector', grant.principal_binding],
    ['scope_selector', [...grant.scopes]],
    ['approval_route_selector', grant.approval_route],
    ['valid_until', grant.issue_time],
    ['valid_from', grant.issue_time],
    ['revoked_at', null],
  ];
  for (const [field, value] of repairs) {
    const fixed = { ...row, [field]: value };
    if (!covering(row, grant) && covering(fixed, grant)) {
      return { field, value };
    }
  }
  return null;
}

function repairMode(field) {
  if (field === 'approval_route_selector') {
    return 'route';
  }
  if (field.endsWith('_selector')) {
    return field.replace('_selector', '');
  }
  if (field.startsWith('valid_') || field === 'revoked_at') {
    return 'time';
  }
  return null;
}

function verifyCounterfactual(batch, capture, label, modeCounts, rowPositions) {
  const { grant } = capture;
  if (label === MALICIOUS) {
    const repaired = structuredClone(batch);
    const twin = repaired.captures.find((item) => item.grant.grant_id === grant.grant_id);
    let witness = null;
    for (const row of twin.registry) {
      const repair = repairOne(row, grant);
      if (repair) {
        rowPositions.add(twin.registry.indexOf(row));
        const mode = repairMode(repair.field);
        if (mode && Object.hasOwn(modeCounts, mode)) {
          modeCounts[mode] += 1;
        }
        witness ??= { row, repair };
      }
    }
    assert.ok(witness, `no one-predicate witness for ${grant.grant_id}`);
    witness.row[witness.repair.field] = witness.repair.value;
    assertTwin(repaired, grant.grant_id, SURVIVOR);
  } else if (label === SURVIVOR) {
    const stripped = structuredClone(batch);
    const twin = stripped.captures.find((item) => item.grant.grant_id === grant.grant_id);
    if (grant.grantor_type === 'admin-consent') {
      twin.grant.verification_state = 'unverified';
    }
    let removed = 0;
    for (const row of twin.registry) {
      if (covering(row, grant)) {
        row.valid_until = grant.issue_time - 1;
        removed += 1;
      }
    }
    assert.ok(removed > 0 || grant.grantor_type === 'admin-consent');
    assertTwin(stripped, grant.grant_id, MALICIOUS);
  }
}

test('frozen grid is fresh, balanced and source-bound', () => {
  const result = generateCaptures();
  assert.equal(result.batches, 36);
  assert.equal(result.records, 468);
  const batches = readLines(NATIVE_PATH);
  const keys = readLines(LABEL_PATH);
  const specs = schedule();
  assert.equal(batches.length, 36);
  assert.equal(keys.length, 36);
  assert.deepEqual(
    [...new Set(specs.map((spec) => spec.maliciousCount))].sort(),
    [0, 1, 2, 3, 4, 5],
  );
  const countHistogram = [0, 0, 0, 0, 0, 0];
  const revokedByCount = Array.from({ length: 6 }, () => new Set());
  const allCaptureIds = new Set();
  const allGrantIds = new Set();
  const modeCounts = { route: 0, time: 0, tenant: 0, principal: 0, scope: 0 };
  const rowPositions = new Set();
  const grantContexts = {
    tenant: new Set(),
    route: new Set(),
    scopes: new Set(),
    grantor: new Set(),
    verification: new Set(),
  };
  let baseOnly = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const spec = specs[index];
    assert.deepEqual([batch.seed, batch.family], [spec.seed, spec.family]);
    assert.ok(FAMILIES.includes(batch.family));
    assert.equal(validateNativeBatch(batch).ok, true);
    const key = evaluatorLabels(batch);
    assert.deepEqual(referenceLabels(batch), key);
    assert.deepEqual(key, keys[index].labels);
    const labels = Object.values(key);
    assert.equal(labels.filter((value) => value === MALICIOUS).length, spec.maliciousCount);
    assert.equal(labels.filter((value) => value === REVOKED).length, spec.revokedCount);
    assert.equal(
      labels.filter((value) => value === SURVIVOR).length,
      13 - spec.maliciousCount - spec.revokedCount,
    );
    countHistogram[spec.maliciousCount] += 1;
    revokedByCount[spec.maliciousCount].add(spec.revokedCount);
    const visible = JSON.stringify(normalizeBatch(batch));
    for (const forbidden of [
      MALICIOUS,
      SURVIVOR,
      REVOKED,
      '_attacker_created_this_run',
      'authorized_by_join',
    ]) {
      assert.equal(visible.includes(forbidden), false);
    }
    for (const capture of batch.captures) {
      const { grant } = capture;
      assert.equal(allCaptureIds.has(capture.capture_id), false);
      assert.equal(allGrantIds.has(grant.grant_id), false);
      allCaptureIds.add(capture.capture_id);
      allGrantIds.add(grant.grant_id);
      assert.equal(grant.principal_binding, capture.remediation.compromised_user);
      grantContexts.tenant.add(grant.tenant);
      grantContexts.route.add(grant.approval_route);
      grantContexts.scopes.add(JSON.stringify(grant.scopes));
      grantContexts.grantor.add(grant.grantor_type);
      grantContexts.verification.add(grant.verification_state);
      if (grant.grantor_type === 'admin-consent') {
        assert.equal(
          capture.registry.some((entry) => covering(entry, grant)),
          false,
        );
        baseOnly += 1;
      }
      assert.equal(
        capture.events.some((event) => event.kind === 'protected-export-call'),
        key[grant.grant_id] !== REVOKED,
      );
      verifyCounterfactual(batch, capture, key[grant.grant_id], modeCounts, rowPositions);
    }
  }
  assert.deepEqual(countHistogram, [6, 6, 6, 6, 6, 6]);
  for (const values of revokedByCount) {
    assert.deepEqual([...values].sort(), [1, 2]);
  }
  assert.equal(allCaptureIds.size, 468);
  assert.equal(allGrantIds.size, 468);
  assert.ok(baseOnly > 0);
  for (const values of Object.values(grantContexts)) {
    assert.ok(values.size > 1);
  }
  assert.ok(rowPositions.size >= 2);
  for (const count of Object.values(modeCounts)) {
    assert.ok(count > 0);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const v8 = path.join(here, '../chain-v8/capture/native-v8.jsonl');
  const oldIds = new Set(
    readLines(v8).flatMap((batch) => batch.captures.map((capture) => capture.grant.grant_id)),
  );
  for (const id of allGrantIds) {
    assert.equal(oldIds.has(id), false);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(manifest.capture_sha256, sha(NATIVE_PATH));
  assert.equal(manifest.labels_sha256, sha(LABEL_PATH));
  for (const [name, digest] of Object.entries(manifest.source_sha256)) {
    assert.equal(digest, sha(path.join(here, '..', name)));
  }
});

test('model-free base, missing selector, wrong scope and revoked controls', () => {
  const batch = readLines(NATIVE_PATH)[0];
  const key = evaluatorLabels(batch);
  const authorized = batch.captures.find((item) => key[item.grant.grant_id] === SURVIVOR);
  const revoked = batch.captures.find((item) => key[item.grant.grant_id] === REVOKED);
  assert.ok(authorized && revoked);
  assertTwin(batch, revoked.grant.grant_id, REVOKED);
  const base = structuredClone(batch);
  const baseCapture = base.captures.find(
    (item) => item.grant.grant_id === authorized.grant.grant_id,
  );
  baseCapture.registry = [];
  Object.assign(baseCapture.grant, {
    grantor_type: 'admin-consent',
    approval_route: 'admin-approved',
    verification_state: 'catalog-approved',
  });
  assertTwin(base, authorized.grant.grant_id, SURVIVOR);
  for (const mode of ['missing', 'wrong-scope']) {
    const changed = structuredClone(batch);
    const item = changed.captures.find(
      (capture) => capture.grant.grant_id === authorized.grant.grant_id,
    );
    for (const row of item.registry.filter((entry) => covering(entry, item.grant))) {
      if (mode === 'missing') {
        delete row.tenant_selector;
      } else {
        row.scope_selector = ['reports.read'];
      }
    }
    // Missing selector is a valid fail-closed consumer control, but outside strict native schema.
    if (mode === 'missing') {
      assert.equal(validateNativeBatch(changed).ok, false);
      continue;
    }
    assertTwin(changed, authorized.grant.grant_id, MALICIOUS);
  }
});

test('top-k, row-order, event-only, allowlist and ID shortcuts fail', () => {
  const batches = readLines(NATIVE_PATH);
  let topKFailures = 0;
  let firstFailures = 0;
  let lastFailures = 0;
  let eventFailures = 0;
  let allowlistFailures = 0;
  let noRegistryShortcutFailures = 0;
  for (const batch of batches) {
    const key = evaluatorLabels(batch);
    const ordered = batch.captures;
    for (let index = 0; index < ordered.length; index += 1) {
      const capture = ordered[index];
      const { grant, registry } = capture;
      const actual = key[grant.grant_id] === MALICIOUS;
      topKFailures += Number(index < 3 !== actual);
      firstFailures += Number((!registry[0] || !covering(registry[0], grant)) !== actual);
      lastFailures += Number((!registry.at(-1) || !covering(registry.at(-1), grant)) !== actual);
      eventFailures += Number(
        capture.events.some((event) => event.kind === 'protected-export-call') !== actual,
      );
      allowlistFailures += Number(false !== actual);
      noRegistryShortcutFailures += Number(
        (registry.every((row) => !covering(row, grant)) &&
          !capture.remediation.revoked_grant_ids.includes(grant.grant_id)) !== actual,
      );
    }
  }
  for (const failures of [
    topKFailures,
    firstFailures,
    lastFailures,
    eventFailures,
    allowlistFailures,
    noRegistryShortcutFailures,
  ]) {
    assert.ok(failures > 0);
  }
  const renamed = structuredClone(batches[0]);
  const oldKey = evaluatorLabels(renamed);
  for (const capture of renamed.captures) {
    const oldId = capture.grant.grant_id;
    const newId = `opaque-${oldId}`;
    capture.grant.grant_id = newId;
    capture.capture_id = `opaque-${capture.capture_id}`;
    for (const event of capture.events) {
      if (event.grant_id === oldId) {
        event.grant_id = newId;
      }
      if (Array.isArray(event.revoked_grant_ids)) {
        event.revoked_grant_ids = event.revoked_grant_ids.map((id) => (id === oldId ? newId : id));
      }
    }
    capture.remediation.revoked_grant_ids = capture.remediation.revoked_grant_ids.map((id) =>
      id === oldId ? newId : id,
    );
  }
  assert.equal(validateNativeBatch(renamed).ok, true);
  for (const [id, label] of Object.entries(oldKey)) {
    assert.equal(evaluatorLabels(renamed)[`opaque-${id}`], label);
  }
  const memorizedIds = new Set(
    Object.entries(oldKey)
      .filter(([, label]) => label === MALICIOUS)
      .map(([id]) => id),
  );
  const renamedKey = evaluatorLabels(renamed);
  assert.ok(
    renamed.captures.some(
      (capture) =>
        renamedKey[capture.grant.grant_id] === MALICIOUS &&
        !memorizedIds.has(capture.grant.grant_id),
    ),
  );
});

test('trusted reference SQL exactly matches every projected control', () => {
  const controls = makeProjectedControls(readLines(NATIVE_PATH));
  assert.equal(controls.length, 14);
  assert.equal(new Set(controls.map((control) => control.id)).size, controls.length);
  const schema = Object.fromEntries(
    Object.keys(controls[0].tables).map((name) => [
      name,
      Object.keys(controls.flatMap((control) => control.tables[name])[0]),
    ]),
  );
  const sql = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference.sql'),
    'utf8',
  );
  for (const control of controls) {
    assert.deepEqual(
      trustedReferenceSql(control.tables, schema, sql),
      control.expected_alert_ids,
      control.id,
    );
  }
});
