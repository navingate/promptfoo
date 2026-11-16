import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addJsonQuoteOnly,
  EXPECTED_C_SQL_SHA256,
  PATCHED_CHILD_SHA256,
  runReplay,
  validateCapturedSql,
} from './jsonquote_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(family, 'chain-v12/manifest.json'), 'utf8'));
const child = fs.readFileSync(path.join(family, 'chain-v9/sql_child.py'), 'utf8');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const referenceSql = () =>
  fs
    .readFileSync(path.join(family, 'chain-v9/reference.sql'), 'utf8')
    .replace(/^--[^\n]*\n/u, '')
    .trim();

test('diagnostic adds only json_quote to the manifest-bound authorizer', () => {
  assert.equal(sha256(child), manifest.source_sha256['chain-v9/sql_child.py']);
  const patched = addJsonQuoteOnly(child);
  assert.equal(sha256(patched), PATCHED_CHILD_SHA256);
  assert.equal(patched.replace(' "json_quote",', ''), child);
  assert.throws(() => addJsonQuoteOnly(child.replace('"json_array_length",', '')));
  assert.throws(() => addJsonQuoteOnly(`${child}\n${child}`));
});

test('replay accepts only the exact captured C SQL bytes', () => {
  const sql = 'SELECT grant_id FROM grants';
  assert.equal(validateCapturedSql(sql, sha256(sql)), sha256(sql));
  assert.throws(() => validateCapturedSql(sql, EXPECTED_C_SQL_SHA256), /SHA-256 mismatch/);
  assert.throws(() => validateCapturedSql('DELETE FROM grants', sha256('DELETE FROM grants')));
  assert.throws(() => validateCapturedSql(`SELECT '${'x'.repeat(8190)}'`, '0'.repeat(64)));
  assert.equal(validateCapturedSql(referenceSql(), sha256(referenceSql())), sha256(referenceSql()));
});

test('offline replay scores the frozen C native and control sets without a model request', async () => {
  const sql = 'SELECT grant_id FROM grants';
  let calls = 0;
  const summary = await runReplay({
    sql,
    expectedSha256: sha256(sql),
    executor: {
      executeSqlCorpus: async ({ batches }) => {
        calls += 1;
        assert.equal(batches.length, calls === 1 ? 36 : 16);
        return batches.map(() => []);
      },
    },
  });
  assert.equal(calls, 2);
  assert.equal(summary.actual_model_requests, 0);
  assert.equal(summary.sql_sha256, sha256(sql));
  assert.equal(summary.native_batches, 36);
  assert.equal(summary.projected_controls_total, 16);
  assert.equal(summary.classification, 'model_fail');
  assert.equal(summary.fp, 0);
  assert.equal(summary.fn, 90);
  assert.equal(summary.diagnostic_only, true);
  assert.equal(JSON.stringify(summary).includes(sql), false);
});

test('patched Linux Docker executor preserves the C reference result', {
  skip: process.platform !== 'linux',
}, async () => {
  const sql = referenceSql();
  const summary = await runReplay({ sql, expectedSha256: sha256(sql) });
  assert.equal(summary.actual_model_requests, 0);
  assert.equal(summary.classification, 'pass');
  assert.equal(summary.exact_batches, 36);
  assert.equal(summary.projected_controls_exact, 16);
});
