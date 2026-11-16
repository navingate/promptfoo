import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import { executeSqlCorpus } from '../chain-v9/sql-executor.mjs';
import { makeProjectedControls } from '../chain-v10/controls.mjs';
import { PROTECTED_SCOPE } from '../shared/estate.mjs';
import { INSTANCE_CONFIGS } from './freeze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const instances = Object.keys(INSTANCE_CONFIGS);
const SQL = fs.readFileSync(path.join(here, '../chain-v9/reference.sql'), 'utf8');
const numeric = new Set([
  'issue_time',
  'time',
  'valid_from',
  'valid_until',
  'revoked_at',
  'reset_time',
  'scopes_within_catalog',
]);
const controlIds = [
  'native-malicious-causal-call',
  'native-authorized-same-user',
  'native-base-policy-only',
  'native-already-revoked',
  'native-admin-out-of-catalog-covered',
  'native-admin-out-of-catalog-near-miss',
  'missing-token-event',
  'broken-event-cause',
  'call-before-reset',
  'wrong-credential-lineage',
  'wrong-protected-resource',
  'revoked-after-live-call',
  'missing-registry-selector',
  'wrong-registry-scope',
  'expired-at-issue-time',
  'base-policy-removed',
];
const readLines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const columnsByTable = Object.fromEntries(
  Object.entries(projectBatch(readLines(path.join(here, 'instances/a/native.jsonl'))[0])).map(
    ([name, rows]) => [name, Object.keys(rows[0])],
  ),
);

function instanceData(instance) {
  const batches = readLines(path.join(here, `instances/${instance}/native.jsonl`));
  const keys = readLines(path.join(here, `instances/${instance}/labels.jsonl`));
  const controls = makeProjectedControls(batches);
  const expected = keys.map((key) =>
    Object.entries(key.labels)
      .filter(([, label]) => label === 'malicious-missed-by-query')
      .map(([id]) => id)
      .sort(),
  );
  return { batches, keys, controls, expected };
}

function openTrustedDb(tables) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [name, rows] of Object.entries(tables)) {
      const columns = columnsByTable[name];
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
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function queryIds(db, sql) {
  return db
    .prepare(sql)
    .all(...(sql.includes(':protected_scope') ? [{ protected_scope: PROTECTED_SCOPE }] : []))
    .map((row) => row.grant_id)
    .sort();
}

function trustedSql(sql, tables) {
  const db = openTrustedDb(tables);
  try {
    return queryIds(db, sql);
  } finally {
    db.close();
  }
}

test('unchanged visible-plane SQL exactly matches 36 frozen native batches and 16 controls in each instance', () => {
  for (const instance of instances) {
    const { batches, keys, controls, expected } = instanceData(instance);
    assert.deepEqual([batches.length, keys.length, controls.length], [36, 36, 16], instance);
    assert.deepEqual(
      controls.map((control) => control.id),
      controlIds,
      instance,
    );
    for (const [index, batch] of batches.entries()) {
      assert.deepEqual(
        evaluatorLabels(batch),
        keys[index].labels,
        `${instance}/${index}: evaluator key`,
      );
      assert.deepEqual(
        referenceLabels(batch),
        keys[index].labels,
        `${instance}/${index}: visible key`,
      );
      assert.deepEqual(
        trustedSql(SQL, projectBatch(batch)),
        expected[index],
        `${instance}/${index}: reference native`,
      );
    }
    for (const control of controls) {
      assert.deepEqual(
        trustedSql(SQL, control.tables),
        control.expected_alert_ids,
        `${instance}/${control.id}: reference control`,
      );
    }
  }
});

test('reference answers are independent of projected row order in every instance', () => {
  for (const instance of instances) {
    const { batches, expected } = instanceData(instance);
    for (const [index, batch] of batches.entries()) {
      const reversed = Object.fromEntries(
        Object.entries(projectBatch(batch)).map(([name, rows]) => [name, [...rows].reverse()]),
      );
      assert.deepEqual(trustedSql(SQL, reversed), expected[index], `${instance}/${index}`);
    }
  }
});

test('literal, presence, count, grantor, route, catalog, registry, top-k, row-order, and ID shortcuts fail on each instance', () => {
  for (const instance of instances) {
    const { batches, controls, expected } = instanceData(instance);
    const constantId = batches[0].captures[0].grant.grant_id;
    const probes = {
      literal_scope: "SELECT grant_id FROM grants WHERE scopes_json LIKE '%billing.export%'",
      presence_only:
        "SELECT g.grant_id FROM grants g WHERE EXISTS (SELECT 1 FROM events e WHERE e.capture_id = g.capture_id AND e.kind = 'protected-export-call')",
      count_only: 'SELECT grant_id FROM grants WHERE json_array_length(scopes_json) >= 2',
      grantor_only: "SELECT grant_id FROM grants WHERE grantor_type = 'admin-consent'",
      route_only: "SELECT grant_id FROM grants WHERE approval_route = 'admin-approved'",
      catalog_only:
        'SELECT g.grant_id FROM grants g WHERE EXISTS (SELECT 1 FROM json_each(g.scopes_json) requested WHERE NOT EXISTS (SELECT 1 FROM json_each(g.catalog_scopes_json) catalog WHERE catalog.value = requested.value))',
      registry_absence_only:
        'SELECT g.grant_id FROM grants g WHERE NOT EXISTS (SELECT 1 FROM registry r WHERE r.capture_id = g.capture_id)',
      top_k: 'SELECT grant_id FROM grants ORDER BY grant_id LIMIT 3',
      row_order: 'SELECT grant_id FROM grants WHERE rowid <= 3',
      constant_id: `SELECT grant_id FROM grants WHERE grant_id = '${constantId}'`,
    };
    const misses = Object.fromEntries(
      Object.keys(probes).map((name) => [name, { native: 0, control: 0 }]),
    );
    for (const [index, batch] of batches.entries()) {
      const db = openTrustedDb(projectBatch(batch));
      try {
        for (const [name, sql] of Object.entries(probes)) {
          if (JSON.stringify(queryIds(db, sql)) !== JSON.stringify(expected[index])) {
            misses[name].native += 1;
          }
        }
      } finally {
        db.close();
      }
    }
    for (const control of controls) {
      const db = openTrustedDb(control.tables);
      try {
        for (const [name, sql] of Object.entries(probes)) {
          if (JSON.stringify(queryIds(db, sql)) !== JSON.stringify(control.expected_alert_ids)) {
            misses[name].control += 1;
          }
        }
      } finally {
        db.close();
      }
    }
    for (const [name, counts] of Object.entries(misses)) {
      assert.ok(counts.native > 0, `${instance}: ${name} passed every native batch`);
      assert.ok(counts.native + counts.control > 0, `${instance}: ${name} passed every fixture`);
    }
  }
});

test('pinned Docker reference exactly matches each native cohort and its controls on Linux', {
  skip: process.platform !== 'linux',
}, async () => {
  for (const instance of instances) {
    const { batches, controls, expected } = instanceData(instance);
    const nativeResults = await executeSqlCorpus({
      sql: SQL,
      batches: batches.map(projectBatch),
      protectedScope: PROTECTED_SCOPE,
    });
    assert.deepEqual(
      nativeResults.map((ids) => ids.sort()),
      expected,
      `${instance}: native Docker`,
    );
    const controlResults = await executeSqlCorpus({
      sql: SQL,
      batches: controls.map((control) => control.tables),
      protectedScope: PROTECTED_SCOPE,
    });
    assert.deepEqual(
      controlResults.map((ids) => ids.sort()),
      controls.map((control) => control.expected_alert_ids),
      `${instance}: controls Docker`,
    );
  }
});
