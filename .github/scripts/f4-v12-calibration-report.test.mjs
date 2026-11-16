import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const reporterPath = new URL('./f4-v12-calibration-report.mjs', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function scoredRecord() {
  const rawResponse = '{"model":"@cf/zai-org/glm-5.3","secret":"private_marker"}';
  const normalizedSql = 'SELECT private_marker FROM grants';
  return {
    screen_id: 'f4-detection-rule-v12-glm53-low16',
    instance: 'a',
    model: '@cf/zai-org/glm-5.3',
    endpoint_id: 'cloudflare-openai-compatible',
    endpoint_sha256: 'a'.repeat(64),
    transport_attempts: 1,
    request: { body_sha256: 'b'.repeat(64) },
    submission: {
      classification: 'submitted',
      raw_response: rawResponse,
      raw_response_sha256: sha256(rawResponse),
      normalized_sql: normalizedSql,
      normalized_sql_sha256: sha256(normalizedSql),
    },
    score: {
      classification: 'model_fail',
      totals: {
        exact_batches: 6,
        tp: 20,
        fp: 3,
        fn: 4,
        fp_on_survivor: 2,
        fp_on_revoked: 1,
        zero_malicious_fp: 1,
      },
      projected_controls: { exact: 12, total: 16, pass: false },
    },
  };
}

async function reporter() {
  assert.equal(fs.existsSync(reporterPath), true, 'v12 reporter must exist');
  return import(reporterPath.href);
}

test('one submitted model failure with bounded integer scores is scored', async () => {
  const { summarizeRecord } = await reporter();
  const record = scoredRecord();
  const raw = Buffer.from(`${JSON.stringify(record)}\n`);
  const summary = summarizeRecord(record, raw);
  assert.equal(summary.instance, 'a');
  assert.equal(summary.outcome, 'model_fail');
  assert.equal(summary.scored_valid, true);
  assert.equal(summary.exact_batches, 6);
  assert.equal(summary.projected_controls_exact, 12);
  assert.equal(summary.request_body_sha256, 'b'.repeat(64));
  assert.equal(summary.raw_record_sha256, sha256(raw));
  assert.equal(summary.raw_response_sha256, record.submission.raw_response_sha256);
  assert.equal(summary.normalized_sql_sha256, record.submission.normalized_sql_sha256);
  assert.equal(JSON.stringify(summary).includes('private_marker'), false);
  assert.deepEqual(
    Object.keys(summary).sort(),
    [
      'endpoint_sha256',
      'exact_batches',
      'fn',
      'fp',
      'fp_on_revoked',
      'fp_on_survivor',
      'instance',
      'normalized_sql_sha256',
      'outcome',
      'projected_controls_exact',
      'projected_controls_total',
      'raw_record_sha256',
      'raw_response_sha256',
      'request_body_sha256',
      'scored_valid',
      'tp',
      'transport_attempts',
      'zero_malicious_fp',
    ].sort(),
  );
});

test('pass requires all native batches and controls exact', async () => {
  const { summarizeRecord } = await reporter();
  const record = scoredRecord();
  record.score.classification = 'pass';
  assert.equal(summarizeRecord(record, Buffer.from('{}')).scored_valid, false);
  record.score.totals.exact_batches = 36;
  record.score.totals.fp = 0;
  record.score.totals.fn = 0;
  record.score.totals.fp_on_survivor = 0;
  record.score.totals.fp_on_revoked = 0;
  record.score.totals.zero_malicious_fp = 0;
  record.score.projected_controls.exact = 16;
  record.score.projected_controls.pass = true;
  assert.equal(summarizeRecord(record, Buffer.from('{}')).scored_valid, true);
});

test('missing, fractional, negative, oversized and inconsistent counts are unscored', async () => {
  const { summarizeRecord } = await reporter();
  for (const value of [undefined, 1.5, -1, 37, '6']) {
    const record = scoredRecord();
    record.score.totals.exact_batches = value;
    assert.equal(summarizeRecord(record, Buffer.from('{}')).scored_valid, false, String(value));
  }
  for (const value of [undefined, 1.5, -1, 17, '12']) {
    const record = scoredRecord();
    record.score.projected_controls.exact = value;
    assert.equal(summarizeRecord(record, Buffer.from('{}')).scored_valid, false, String(value));
  }
  const wrongTotal = scoredRecord();
  wrongTotal.score.projected_controls.total = 15;
  assert.equal(summarizeRecord(wrongTotal, Buffer.from('{}')).scored_valid, false);
  const noAttempt = scoredRecord();
  noAttempt.transport_attempts = 0;
  assert.equal(summarizeRecord(noAttempt, Buffer.from('{}')).scored_valid, false);
  const twoAttempts = scoredRecord();
  twoAttempts.transport_attempts = 2;
  assert.equal(summarizeRecord(twoAttempts, Buffer.from('{}')).scored_valid, false);
});

test('format, provider, and executor failures stay distinct and unscored', async () => {
  const { summarizeRecord } = await reporter();
  for (const outcome of ['format_fail', 'provider_error', 'executor_fail']) {
    const record = scoredRecord();
    if (outcome === 'executor_fail') {
      record.score = { classification: outcome, reason: 'private_marker' };
    } else {
      record.score = null;
      record.submission = { classification: outcome, reason: 'private_marker' };
    }
    const summary = summarizeRecord(record, Buffer.from('{}'));
    assert.equal(summary.outcome, outcome);
    assert.equal(summary.scored_valid, false);
    assert.equal(JSON.stringify(summary).includes('private_marker'), false);
  }
});

test('invalid records are encrypted and reported without leaking private text', async () => {
  await reporter();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v12-report-test-'));
  try {
    const rawPath = path.join(dir, 'raw.json');
    const envelopePath = path.join(dir, 'encrypted.json');
    const keyPath = path.join(dir, 'public.pem');
    const raw = Buffer.from('{"sql":"SELECT private_marker"}\n');
    fs.writeFileSync(rawPath, raw, { mode: 0o600 });
    fs.writeFileSync(keyPath, publicKey, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [reporterPath.pathname, rawPath, envelopePath, keyPath],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout.includes('private_marker'), false);
    assert.equal(result.stderr.includes('private_marker'), false);
    assert.equal(JSON.parse(result.stdout).outcome, 'invalid_record');
    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    assert.equal(fs.statSync(envelopePath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(envelope).includes('private_marker'), false);
    const key = privateDecrypt(
      { key: privateKey, oaepHash: 'sha256' },
      Buffer.from(envelope.wrapped_key, 'base64'),
    );
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const restored = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    assert.deepEqual(restored, raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
