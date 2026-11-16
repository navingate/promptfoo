#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encryptRecord } from './f4-v10-calibration-report.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const outcomes = new Set(['pass', 'model_fail', 'format_fail', 'provider_error', 'executor_fail']);
const instances = new Set(['a', 'b', 'c']);

function count(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function verifiedDigest(value, expected) {
  const valid = digest(expected);
  return typeof value === 'string' && valid === sha256(value) ? valid : null;
}

export function summarizeRecord(record, raw) {
  const outcomeCandidate = record?.score?.classification ?? record?.submission?.classification;
  const outcome = outcomes.has(outcomeCandidate) ? outcomeCandidate : 'invalid_record';
  const totals = record?.score?.totals;
  const controls = record?.score?.projected_controls;
  const exactBatches = count(totals?.exact_batches, 36);
  const controlsExact = count(controls?.exact, 16);
  const controlsTotal = count(controls?.total, 16);
  const tp = count(totals?.tp, 468);
  const fp = count(totals?.fp, 468);
  const fn = count(totals?.fn, 468);
  const fpOnSurvivor = count(totals?.fp_on_survivor, 468);
  const fpOnRevoked = count(totals?.fp_on_revoked, 468);
  const zeroMaliciousFp = count(totals?.zero_malicious_fp, 468);
  const rawResponseSha256 = verifiedDigest(
    record?.submission?.raw_response,
    record?.submission?.raw_response_sha256,
  );
  const normalizedSqlSha256 = verifiedDigest(
    record?.submission?.normalized_sql,
    record?.submission?.normalized_sql_sha256,
  );
  const scoreCountsValid =
    [exactBatches, controlsExact, tp, fp, fn, fpOnSurvivor, fpOnRevoked, zeroMaliciousFp].every(
      (value) => value !== null,
    ) &&
    controlsTotal === 16 &&
    fpOnSurvivor <= fp &&
    fpOnRevoked <= fp &&
    zeroMaliciousFp <= fp &&
    controls?.pass === (controlsExact === 16);
  const classificationConsistent =
    outcome === 'model_fail' ||
    (exactBatches === 36 && controlsExact === 16 && fp === 0 && fn === 0);
  const scoredValid =
    instances.has(record?.instance) &&
    record?.screen_id === 'f4-detection-rule-v12-glm53-low16' &&
    record?.model === '@cf/zai-org/glm-5.3' &&
    record?.endpoint_id === 'cloudflare-openai-compatible' &&
    record?.transport_attempts === 1 &&
    record?.submission?.classification === 'submitted' &&
    (outcome === 'pass' || outcome === 'model_fail') &&
    digest(record?.endpoint_sha256) !== null &&
    digest(record?.request?.body_sha256) !== null &&
    rawResponseSha256 !== null &&
    normalizedSqlSha256 !== null &&
    scoreCountsValid &&
    classificationConsistent;
  return {
    instance: instances.has(record?.instance) ? record.instance : null,
    outcome,
    scored_valid: scoredValid,
    transport_attempts: count(record?.transport_attempts, Number.MAX_SAFE_INTEGER),
    exact_batches: exactBatches,
    projected_controls_exact: controlsExact,
    projected_controls_total: controlsTotal,
    tp,
    fp,
    fn,
    fp_on_survivor: fpOnSurvivor,
    fp_on_revoked: fpOnRevoked,
    zero_malicious_fp: zeroMaliciousFp,
    endpoint_sha256: digest(record?.endpoint_sha256),
    request_body_sha256: digest(record?.request?.body_sha256),
    raw_response_sha256: rawResponseSha256,
    normalized_sql_sha256: normalizedSqlSha256,
    raw_record_sha256: sha256(raw),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    throw new Error('exactly three reporter paths are required');
  }
  const [rawPath, envelopePath, publicKeyPath] = args;
  const raw = fs.readFileSync(rawPath);
  const key = fs.readFileSync(publicKeyPath, 'utf8');
  const envelope = encryptRecord(raw, key);
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope)}\n`, { flag: 'wx', mode: 0o600 });
  let record = null;
  try {
    record = JSON.parse(raw.toString('utf8'));
  } catch {
    // An incomplete raw file is still retained as encrypted evidence.
  }
  const summary = summarizeRecord(record, raw);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.scored_valid) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    process.stderr.write('F4 v12 reporter failed; inspect private runner files\n');
    process.exitCode = 2;
  }
}
