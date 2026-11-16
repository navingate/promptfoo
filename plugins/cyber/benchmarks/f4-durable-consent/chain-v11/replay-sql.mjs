#!/usr/bin/env node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_ID, runScreen } from '../chain-v10/screen.mjs';

const EXPECTED_SHA256 = '7af7d2817237e9ebe6b033928e00aff3d0e1316cdfb581ac3f119939b3bd3e63';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export function validateReplaySql(sql, expectedSha) {
  if (
    typeof sql !== 'string' ||
    !/^(?:SELECT|WITH)\b/iu.test(sql) ||
    Buffer.byteLength(sql) > 8192
  ) {
    throw new Error('one SQL SELECT within 8192 bytes required');
  }
  const digest = sha(sql);
  if (digest !== expectedSha) {
    throw new Error('captured SQL SHA-256 mismatch');
  }
  return digest;
}

export function safeReplaySummary(record, sqlSha) {
  const score = record.score ?? {};
  const totals = score.totals ?? {};
  const controls = score.projected_controls ?? {};
  if (!['pass', 'model_fail', 'executor_fail'].includes(score.classification)) {
    throw new Error('unknown replay classification');
  }
  return {
    diagnostic_id: 'f4-v11-defenced-sql-replay',
    actual_model_requests: 0,
    sql_sha256: sqlSha,
    classification: score.classification,
    exact_batches: count(totals.exact_batches),
    native_batches: 36,
    projected_controls_exact: count(controls.exact),
    projected_controls_total: count(controls.total),
    tp: count(totals.tp),
    fp: count(totals.fp),
    fn: count(totals.fn),
    fp_on_survivor: count(totals.fp_on_survivor),
    fp_on_revoked: count(totals.fp_on_revoked),
    zero_malicious_fp: count(totals.zero_malicious_fp),
  };
}

export async function runReplay({ sql, expectedSha, output, screen = runScreen }) {
  const sqlSha = validateReplaySql(sql, expectedSha);
  const response = new Response(
    JSON.stringify({
      model: MODEL_ID,
      choices: [{ finish_reason: 'stop', message: { content: sql } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const record = await screen({
    mock: true,
    output,
    request: async () => response,
  });
  return safeReplaySummary(record, sqlSha);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, output] = process.argv.slice(2);
  if (flag !== '--output' || !output) {
    throw new Error('private --output is required');
  }
  runReplay({
    sql: process.env.F4_V11_DEFENCED_SQL,
    expectedSha: EXPECTED_SHA256,
    output,
  })
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (summary.classification === 'executor_fail') {
        process.exitCode = 2;
      }
    })
    .catch(() => {
      process.stderr.write('F4 offline replay failed\n');
      process.exitCode = 2;
    });
}
