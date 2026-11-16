#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTECTED_SCOPE } from '../../shared/estate.mjs';
import { verifyManifest } from '../manifest.mjs';
import { scoreOne, validateBoundSql } from './fairness_audit.mjs';
import { createVariantExecutor, PATCHED_CHILD_SHA256 } from './jsonquote_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../manifest.json');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const ASTRA_FIRST_SQL_SHA256 =
  '20986332705ab896fd43883f1ec9de398299c9ad124f04f764229cbc4f69cb60';
export const RECURSIVE_CHILD_SHA256 =
  '889609df25e0c8edb5e0774f4081540692734cf4d0d915c0bf868a161a413abc';
const BAN = '    if "RECURSIVE" in tokens:\n        raise ValueError("recursive SQL denied")\n';
const PREFLIGHT_CASE =
  '        "WITH /* gap */ RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT grant_id FROM grants",\n';

export function allowRecursiveOnly(source) {
  if (
    typeof source !== 'string' ||
    sha256(source) !== PATCHED_CHILD_SHA256 ||
    source.split(BAN).length !== 2 ||
    source.split(PREFLIGHT_CASE).length !== 2
  ) {
    throw new Error('original child shape mismatch');
  }
  const patched = source.replace(BAN, '').replace(PREFLIGHT_CASE, '');
  if (sha256(patched) !== RECURSIVE_CHILD_SHA256) {
    throw new Error('recursive child digest mismatch');
  }
  return patched;
}

export async function runAstraBlindAudit(env = process.env) {
  const sql = env.F4_ASTRA_FIRST_SQL;
  validateBoundSql(sql, ASTRA_FIRST_SQL_SHA256);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const corpora = verifyManifest(manifest);
  let variant;
  try {
    variant = await createVariantExecutor(manifest);
    const childPath = path.join(variant.privateDir, 'sql_child.py');
    fs.writeFileSync(childPath, allowRecursiveOnly(fs.readFileSync(childPath, 'utf8')));
    await variant.module.preflightSqlExecutor();
    await variant.module.executeSql({
      sql: 'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n < 3) SELECT grant_id FROM grants JOIN x ON x.n = 3 LIMIT 1',
      tables: corpora.a.projected[0],
      protectedScope: PROTECTED_SCOPE,
    });
    const scored = [];
    for (const [instance, corpus] of Object.entries(corpora)) {
      try {
        scored.push(await scoreOne(variant.module, corpus, sql, instance));
      } catch {
        scored.push({ instance, classification: 'executor_fail', reason: 'bounded SQL rejected' });
      }
    }
    return {
      audit_id: 'f4-v12-astra-first-blind-rule',
      diagnostic_only: true,
      scored_model_calls: 0,
      original_v12_executor: 'recursive SQL denied',
      variant_change: 'permit recursive CTE under existing Linux Docker and VM/time/memory bounds',
      manifest_sha256: sha256(manifestBytes),
      sql_sha256: ASTRA_FIRST_SQL_SHA256,
      child_sha256: RECURSIVE_CHILD_SHA256,
      scored,
    };
  } finally {
    if (variant) {
      fs.rmSync(variant.privateDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAstraBlindAudit()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write('F4 Astra blind diagnostic failed; no SQL is logged\n');
      process.exitCode = 2;
    });
}
