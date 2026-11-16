#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreAlerts, scoreProjectedControls } from '../../chain-v10/screen.mjs';
import { PROTECTED_SCOPE } from '../../shared/estate.mjs';
import { verifyManifest } from '../manifest.mjs';
import { createVariantExecutor } from './jsonquote_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../manifest.json');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const CORRECTED_GLM = Object.freeze({
  a: '01bad6598bb9f46c1b1ef1e9d8ac04b3dd23963eea492fc56b80565e100b18f6',
  b: '8ea9a4568154aa69f009361f95def101c197244c334242eb27e6d3afe918a783',
  c: 'ea8820c0ebeaff60c1b86bc367eaa2f34e9e507ad87a86b9fc90716c33cfb63e',
});

export function validateBoundSql(sql, expectedSha256) {
  if (
    typeof sql !== 'string' ||
    !/^(?:SELECT|WITH)\b/iu.test(sql) ||
    Buffer.byteLength(sql) > 8192
  ) {
    throw new Error('one SQL SELECT within 8192-byte limit required');
  }
  if (sha256(sql) !== expectedSha256) {
    throw new Error('SQL digest mismatch');
  }
  return expectedSha256;
}

export async function scoreOne(executor, corpus, sql, instance) {
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
  return {
    instance,
    exact_batches: score.totals.exact_batches,
    native_batches: corpus.batches.length,
    projected_controls_exact: controls.exact,
    projected_controls_total: controls.total,
    tp: score.totals.tp,
    fp: score.totals.fp,
    fn: score.totals.fn,
    fp_on_survivor: score.totals.fp_on_survivor,
    fp_on_revoked: score.totals.fp_on_revoked,
    by_family: score.by_family,
  };
}

export async function runCorrectedGlmAudit(env = process.env) {
  const inputs = Object.fromEntries(
    Object.entries(CORRECTED_GLM).map(([instance, expected]) => {
      const sql = env[`F4_GLM_${instance.toUpperCase()}_TEXT_SQL`];
      validateBoundSql(sql, expected);
      return [instance, sql];
    }),
  );
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const corpora = verifyManifest(manifest);
  let variant;
  try {
    variant = await createVariantExecutor(manifest);
    await variant.module.preflightSqlExecutor();
    await variant.module.executeSql({
      sql: 'SELECT grant_id FROM grants WHERE json_quote(client_id) IS NOT NULL LIMIT 1',
      tables: corpora.a.projected[0],
      protectedScope: PROTECTED_SCOPE,
    });
    const scored = [];
    for (const [instance, sql] of Object.entries(inputs)) {
      try {
        scored.push(await scoreOne(variant.module, corpora[instance], sql, instance));
      } catch {
        scored.push({
          instance,
          classification: 'executor_fail',
          reason: 'corrected SQL rejected',
        });
      }
    }
    return {
      audit_id: 'f4-v12-glm-json-text-correction',
      diagnostic_only: true,
      actual_model_requests: 0,
      manifest_sha256: sha256(manifestBytes),
      sql_sha256: CORRECTED_GLM,
      scored,
    };
  } finally {
    if (variant) {
      fs.rmSync(variant.privateDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCorrectedGlmAudit()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write('F4 fairness diagnostic failed; no SQL is logged\n');
      process.exitCode = 2;
    });
}
