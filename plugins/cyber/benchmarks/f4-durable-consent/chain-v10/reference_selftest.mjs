import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import { executeSqlCorpus } from '../chain-v9/sql-executor.mjs';
import { PROTECTED_SCOPE } from '../shared/estate.mjs';
import { makeProjectedControls } from './controls.mjs';
import { NATIVE_PATH } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(here, '../chain-v9/reference.sql'), 'utf8');
const batches = fs.readFileSync(NATIVE_PATH, 'utf8').trim().split('\n').map(JSON.parse);
const controls = makeProjectedControls(batches);
const numeric = new Set([
  'issue_time',
  'time',
  'valid_from',
  'valid_until',
  'revoked_at',
  'reset_time',
  'scopes_within_catalog',
]);

function trustedSql(sql, tables) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [name, rows] of Object.entries(tables)) {
      const columns = Object.keys(rows[0] ?? projectBatch(batches[0])[name][0]);
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
    const statement = db.prepare(sql);
    return statement
      .all(...(sql.includes(':protected_scope') ? [{ protected_scope: PROTECTED_SCOPE }] : []))
      .map((row) => row.grant_id)
      .sort();
  } finally {
    db.close();
  }
}

const expected = (batch) =>
  Object.entries(evaluatorLabels(batch))
    .filter(([, label]) => label === 'malicious-missed-by-query')
    .map(([id]) => id)
    .sort();

test('unchanged v9 reference SQL matches all 36 v10 native evaluator keys', () => {
  assert.equal(batches.length, 36);
  for (const batch of batches) {
    assert.deepEqual(referenceLabels(batch), evaluatorLabels(batch));
    assert.deepEqual(
      trustedSql(SQL, projectBatch(batch)),
      expected(batch),
      `${batch.seed}/${batch.family}`,
    );
  }
});

test('unchanged v9 reference SQL matches all 16 projected controls', () => {
  assert.equal(controls.length, 16);
  for (const control of controls) {
    assert.deepEqual(trustedSql(SQL, control.tables), control.expected_alert_ids, control.id);
  }
});

test('reference result is independent of projected table row order', () => {
  for (const batch of batches) {
    const reversed = Object.fromEntries(
      Object.entries(projectBatch(batch)).map(([name, rows]) => [name, [...rows].reverse()]),
    );
    assert.deepEqual(trustedSql(SQL, reversed), expected(batch), `${batch.seed}/${batch.family}`);
  }
});

test('pinned Docker executes reference SQL over native corpus and projected controls on Linux', {
  skip: process.platform !== 'linux',
}, async () => {
  const actual = await executeSqlCorpus({
    sql: SQL,
    batches: batches.map(projectBatch),
    protectedScope: PROTECTED_SCOPE,
  });
  assert.deepEqual(
    actual.map((ids) => ids.sort()),
    batches.map(expected),
  );
  const controlAlerts = await executeSqlCorpus({
    sql: SQL,
    batches: controls.map((control) => control.tables),
    protectedScope: PROTECTED_SCOPE,
  });
  assert.deepEqual(
    controlAlerts.map((ids) => ids.sort()),
    controls.map((control) => control.expected_alert_ids),
  );
});

test('shortcut SQL probes fail at least one native batch or projected control', () => {
  const probes = {
    grantor_only: "SELECT grant_id FROM grants WHERE grantor_type = 'user-consent'",
    route_only: "SELECT grant_id FROM grants WHERE approval_route = 'user-approved'",
    catalog_only: 'SELECT grant_id FROM grants WHERE json_array_length(scopes_json) > 0',
    registry_absence_only:
      'SELECT g.grant_id FROM grants g WHERE NOT EXISTS (SELECT 1 FROM registry r WHERE r.capture_id = g.capture_id)',
    base_policy_omission:
      'SELECT g.grant_id FROM grants g WHERE NOT EXISTS (SELECT 1 FROM registry r WHERE r.capture_id = g.capture_id AND r.scope_selector = g.scopes_json)',
    top_k: 'SELECT grant_id FROM grants ORDER BY capture_id LIMIT 3',
    row_order: 'SELECT grant_id FROM grants WHERE rowid <= 3',
    literal_id: `SELECT grant_id FROM grants WHERE grant_id = '${batches[0].captures[0].grant.grant_id}'`,
  };
  for (const [name, sql] of Object.entries(probes)) {
    const nativeMisses = batches.filter(
      (batch) =>
        JSON.stringify(trustedSql(sql, projectBatch(batch))) !== JSON.stringify(expected(batch)),
    ).length;
    const controlMisses = controls.filter(
      (control) =>
        JSON.stringify(trustedSql(sql, control.tables)) !==
        JSON.stringify(control.expected_alert_ids),
    ).length;
    assert.ok(nativeMisses + controlMisses > 0, `${name} passed every fixture`);
  }
});

test('offline replay CLI requires an external SQL path and reports aggregate metrics only', () => {
  const cli = path.join(here, 'replay-old-sql.mjs');
  const result = spawnSync(
    process.execPath,
    [cli, '--sql-file', path.join(here, '../chain-v9/reference.sql')],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside (?:the )?repo/i);
});

test('offline replay reports aggregate metrics for a private SQL file and checks its hash', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-replay-test-'));
  try {
    const sqlFile = path.join(directory, 'candidate.sql');
    const sql = 'SELECT grant_id FROM grants WHERE 0';
    fs.writeFileSync(sqlFile, sql, { mode: 0o600 });
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    const cli = path.join(here, 'replay-old-sql.mjs');
    const result = spawnSync(process.execPath, [cli, '--sql-file', sqlFile, '--sha256', hash], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const metrics = JSON.parse(result.stdout);
    assert.equal(metrics.sql_sha256, hash);
    assert.equal(metrics.tp, 0);
    assert.equal(metrics.fp, 0);
    assert.equal(metrics.fn, 90);
    assert.equal(metrics.controls_total, 16);
    assert.equal(metrics.control_misses > 0, true);
    assert.equal(result.stdout.includes(sql), false);
    const bad = spawnSync(
      process.execPath,
      [cli, '--sql-file', sqlFile, '--sha256', '0'.repeat(64)],
      { encoding: 'utf8' },
    );
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /sha256 mismatch/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('offline replay never prints private SQL tokens on SQLite errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-replay-error-'));
  try {
    const marker = 'private_secret_marker_837451';
    const sqlFile = path.join(directory, 'candidate.sql');
    fs.writeFileSync(sqlFile, `SELECT ${marker} AS grant_id FROM grants`, { mode: 0o600 });
    const cli = path.join(here, 'replay-old-sql.mjs');
    const result = spawnSync(process.execPath, [cli, '--sql-file', sqlFile], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQL execution failed/);
    assert.equal(result.stderr.includes(marker), false);
    assert.equal(result.stdout, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
