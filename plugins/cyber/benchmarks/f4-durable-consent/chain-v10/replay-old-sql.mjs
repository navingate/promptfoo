#!/usr/bin/env node
// Offline replay of a private SQL response against the frozen v10 fixture.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { projectBatch } from '../chain-v9/project.mjs';
import { PROTECTED_SCOPE } from '../shared/estate.mjs';
import { makeProjectedControls } from './controls.mjs';
import { LABEL_PATH, MANIFEST_PATH, NATIVE_PATH } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(here, '../../../../..');
const repositoryRoot = path.resolve(worktreeRoot, '../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const numeric = new Set([
  'issue_time',
  'time',
  'valid_from',
  'valid_until',
  'revoked_at',
  'reset_time',
  'scopes_within_catalog',
]);
const schema = Object.fromEntries(
  Object.entries(projectBatch(JSON.parse(fs.readFileSync(NATIVE_PATH, 'utf8').split('\n')[0]))).map(
    ([name, rows]) => [name, Object.keys(rows[0])],
  ),
);

function argumentsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--sql-file', '--sha256'].includes(flag) || !value || options[flag]) {
      throw new Error('usage: replay-old-sql.mjs --sql-file OUTSIDE_REPO [--sha256 HEX]');
    }
    options[flag] = value;
  }
  if (!options['--sql-file']) {
    throw new Error('--sql-file is required');
  }
  const filename = fs.realpathSync(options['--sql-file']);
  for (const root of [worktreeRoot, repositoryRoot]) {
    if (filename === root || filename.startsWith(`${root}${path.sep}`)) {
      throw new Error('SQL file must be outside the repo');
    }
  }
  const expectedSha = options['--sha256'];
  if (expectedSha && !/^[a-f0-9]{64}$/iu.test(expectedSha)) {
    throw new Error('invalid --sha256');
  }
  return { filename, expectedSha };
}

function readFrozen() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const native = fs.readFileSync(NATIVE_PATH);
  const labels = fs.readFileSync(LABEL_PATH);
  if (sha(native) !== manifest.capture_sha256 || sha(labels) !== manifest.labels_sha256) {
    throw new Error('frozen corpus hash mismatch');
  }
  const batches = native.toString('utf8').trim().split('\n').map(JSON.parse);
  const keys = labels.toString('utf8').trim().split('\n').map(JSON.parse);
  if (
    batches.length !== 36 ||
    keys.length !== 36 ||
    batches.some(
      (batch, index) => batch.seed !== keys[index].seed || batch.family !== keys[index].family,
    )
  ) {
    throw new Error('frozen corpus key mismatch');
  }
  return { batches, keys };
}

function run(sql, tables) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [name, columns] of Object.entries(schema)) {
      db.exec(
        `CREATE TABLE "${name}" (${columns.map((column) => `"${column}" ${numeric.has(column) ? 'INTEGER' : 'TEXT'}`).join(', ')})`,
      );
      const insert = db.prepare(
        `INSERT INTO "${name}" VALUES (${columns.map(() => '?').join(', ')})`,
      );
      for (const row of tables[name]) {
        insert.run(...columns.map((column) => row[column] ?? null));
      }
    }
    db.exec('PRAGMA query_only = ON');
    const statement = db.prepare(sql);
    if (statement.columns().length !== 1 || statement.columns()[0].name !== 'grant_id') {
      throw new Error('SQL result must have one grant_id column');
    }
    const validIds = new Set(tables.grants.map((grant) => grant.grant_id));
    const ids = statement
      .all(...(sql.includes(':protected_scope') ? [{ protected_scope: PROTECTED_SCOPE }] : []))
      .map((row) => row.grant_id);
    if (ids.some((id) => typeof id !== 'string' || !validIds.has(id))) {
      throw new Error('SQL returned an unknown grant ID');
    }
    return [...new Set(ids)];
  } catch {
    // SQLite diagnostics can include fragments of the private SQL response.
    throw new Error('SQL execution failed');
  } finally {
    db.close();
  }
}

function replay(filename, expectedSha) {
  const bytes = fs.readFileSync(filename);
  const sqlSha = sha(bytes);
  if (expectedSha && sqlSha !== expectedSha.toLowerCase()) {
    throw new Error('SHA256 mismatch');
  }
  if (bytes.length > 8192) {
    throw new Error('SQL exceeds 8192 bytes');
  }
  const sql = bytes.toString('utf8');
  if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) {
    throw new Error('one SELECT statement required');
  }
  const { batches, keys } = readFrozen();
  const controls = makeProjectedControls(batches);
  const metrics = {
    sql_sha256: sqlSha,
    tp: 0,
    fp: 0,
    fn: 0,
    exact_batches: 0,
    survivor_fp: 0,
    controls_total: controls.length,
    control_misses: 0,
  };
  for (let index = 0; index < batches.length; index += 1) {
    const labels = keys[index].labels;
    const expected = new Set(
      Object.entries(labels)
        .filter(([, label]) => label === 'malicious-missed-by-query')
        .map(([id]) => id),
    );
    const actual = new Set(run(sql, projectBatch(batches[index])));
    const tp = [...actual].filter((id) => expected.has(id)).length;
    const fp = actual.size - tp;
    const fn = [...expected].filter((id) => !actual.has(id)).length;
    metrics.tp += tp;
    metrics.fp += fp;
    metrics.fn += fn;
    metrics.exact_batches += Number(fp === 0 && fn === 0);
    metrics.survivor_fp += [...actual].filter((id) => labels[id] === 'same-user-survivor').length;
  }
  for (const control of controls) {
    const actual = new Set(run(sql, control.tables));
    const expected = new Set(control.expected_alert_ids);
    metrics.control_misses += Number(
      actual.size !== expected.size || [...expected].some((id) => !actual.has(id)),
    );
  }
  return metrics;
}

try {
  const { filename, expectedSha } = argumentsFor(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(replay(filename, expectedSha))}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
