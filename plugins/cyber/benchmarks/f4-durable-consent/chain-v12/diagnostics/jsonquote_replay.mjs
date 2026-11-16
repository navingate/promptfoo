#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scoreAlerts, scoreProjectedControls } from '../../chain-v10/screen.mjs';
import { PROTECTED_SCOPE } from '../../shared/estate.mjs';
import { verifyManifest } from '../manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const manifestPath = path.join(family, 'chain-v12/manifest.json');
const childPath = path.join(family, 'chain-v9/sql_child.py');
const executorPath = path.join(family, 'chain-v9/sql-executor.mjs');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const EXPECTED_C_SQL_SHA256 =
  '0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210';
export const PATCHED_CHILD_SHA256 =
  'ef829c64c84b4e09b12972e06cceb18dab372fcdc1d1648cf1d25689bc5a6c43';
const MARKER = '"json_each", "json_valid", "json_extract", "json_type", "json_array_length",';

export function validateCapturedSql(sql, expectedSha256 = EXPECTED_C_SQL_SHA256) {
  if (
    typeof sql !== 'string' ||
    !/^(?:SELECT|WITH)\b/iu.test(sql) ||
    Buffer.byteLength(sql) > 8192
  ) {
    throw new Error('one captured SQL SELECT within 8192 bytes required');
  }
  const actual = sha256(sql);
  if (actual !== expectedSha256) {
    throw new Error('captured SQL SHA-256 mismatch');
  }
  return actual;
}

export function addJsonQuoteOnly(source) {
  if (typeof source !== 'string' || source.split(MARKER).length !== 2) {
    throw new Error('original Python authorizer shape mismatch');
  }
  const patched = source.replace(MARKER, `${MARKER} "json_quote",`);
  if (sha256(patched) !== PATCHED_CHILD_SHA256) {
    throw new Error('patched Python authorizer digest mismatch');
  }
  return patched;
}

export async function createVariantExecutor(manifest) {
  const originalChild = fs.readFileSync(childPath, 'utf8');
  const originalExecutor = fs.readFileSync(executorPath, 'utf8');
  if (
    sha256(originalChild) !== manifest.source_sha256['chain-v9/sql_child.py'] ||
    sha256(originalExecutor) !== manifest.source_sha256['chain-v9/sql-executor.mjs']
  ) {
    throw new Error('original SQL executor binding mismatch');
  }
  const patchedChild = addJsonQuoteOnly(originalChild);
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v12-jsonquote-'));
  fs.chmodSync(privateDir, 0o700);
  try {
    const variantChild = path.join(privateDir, 'sql_child.py');
    const variantExecutor = path.join(privateDir, 'sql-executor.mjs');
    // The non-root Docker child must be able to read its bind-mounted code file.
    fs.writeFileSync(variantChild, patchedChild, { flag: 'wx', mode: 0o644 });
    fs.writeFileSync(variantExecutor, originalExecutor, { flag: 'wx', mode: 0o600 });
    const module = await import(pathToFileURL(variantExecutor).href);
    return { module, privateDir };
  } catch (error) {
    fs.rmSync(privateDir, { recursive: true, force: true });
    throw error;
  }
}

export async function runReplay({ sql, expectedSha256 = EXPECTED_C_SQL_SHA256, executor } = {}) {
  const sqlSha = validateCapturedSql(sql, expectedSha256);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const corpus = verifyManifest(manifest).c;
  if (corpus.batches.length !== 36 || corpus.controls.length !== 16) {
    throw new Error('frozen C cohort shape mismatch');
  }

  let variant;
  try {
    if (!executor) {
      variant = await createVariantExecutor(manifest);
      executor = variant.module;
      await executor.preflightSqlExecutor();
      await executor.executeSql({
        sql: 'SELECT grant_id FROM grants WHERE json_quote(client_id) IS NOT NULL LIMIT 1',
        tables: corpus.projected[0],
        protectedScope: PROTECTED_SCOPE,
      });
    }
    const nativeAlerts = await executor.executeSqlCorpus({
      sql,
      batches: corpus.projected,
      protectedScope: PROTECTED_SCOPE,
    });
    const score = scoreAlerts(corpus.batches, corpus.keys, nativeAlerts);
    const controlAlerts = await executor.executeSqlCorpus({
      sql,
      batches: corpus.controls.map((control) => control.tables),
      protectedScope: PROTECTED_SCOPE,
    });
    const controls = scoreProjectedControls(corpus.controls, controlAlerts);
    if (!controls.pass) {
      score.classification = 'model_fail';
    }
    return {
      diagnostic_id: 'f4-v12-c-jsonquote-replay',
      diagnostic_only: true,
      original_v12_classification: 'executor_fail',
      source_run_id: 43908847432,
      source_commit: '3a606855cd3549dd22bfcadfd4265c26317367d1',
      source_response_sha256: '292fcb8a95be77dd526144e9ea8177892d83b353527551823c3e2872609ae8f6',
      actual_model_requests: 0,
      sql_sha256: sqlSha,
      manifest_sha256: sha256(manifestBytes),
      original_executor_sha256: manifest.source_sha256['chain-v9/sql-executor.mjs'],
      original_child_sha256: manifest.source_sha256['chain-v9/sql_child.py'],
      patched_child_sha256: PATCHED_CHILD_SHA256,
      classification: score.classification,
      exact_batches: score.totals.exact_batches,
      native_batches: 36,
      projected_controls_exact: controls.exact,
      projected_controls_total: controls.total,
      tp: score.totals.tp,
      fp: score.totals.fp,
      fn: score.totals.fn,
      fp_on_survivor: score.totals.fp_on_survivor,
      fp_on_revoked: score.totals.fp_on_revoked,
      zero_malicious_fp: score.totals.zero_malicious_fp,
      by_family: score.by_family,
    };
  } finally {
    if (variant) {
      fs.rmSync(variant.privateDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReplay({ sql: process.env.F4_V12_REPLAY_SQL })
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch(() => {
      process.stderr.write('F4 C offline replay failed; no SQL or raw response is logged\n');
      process.exitCode = 2;
    });
}
