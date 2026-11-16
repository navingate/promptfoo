import assert from 'node:assert/strict';
import { createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { test } from 'node:test';

import { encryptRecord, summarizeRecord } from './f4-v10-calibration-report.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('encrypted artifact preserves the raw record without exposing its SQL', () => {
  const raw = Buffer.from('{"sql":"SELECT private_marker"}\n');
  const envelope = encryptRecord(raw, publicKey);
  const json = JSON.stringify(envelope);
  assert.ok(!json.includes('private_marker'));
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
});

test('public summary excludes the model SQL and reports aggregate failure counts', () => {
  const raw = Buffer.from('{"sql":"SELECT private_marker"}\n');
  const record = {
    screen_id: 'f4-detection-rule-v10-glm53-low16',
    transport_attempts: 1,
    submission: { classification: 'submitted', sql: 'SELECT private_marker' },
    score: {
      classification: 'model_fail',
      totals: {
        exact_batches: 17,
        tp: 21,
        fp: 3,
        fn: 9,
        fp_on_survivor: 2,
        fp_on_revoked: 1,
        zero_malicious_fp: 0,
      },
      projected_controls: { exact: 12, total: 16 },
    },
  };
  const summary = summarizeRecord(record, raw);
  assert.equal(summary.classification, 'model_fail');
  assert.equal(summary.exact_batches, 17);
  assert.equal(summary.projected_controls_exact, 12);
  assert.equal(summary.tp, 21);
  assert.ok(!JSON.stringify(summary).includes('private_marker'));
  assert.equal(summary.raw_sha256.length, 64);
});

test('format failures remain model outcomes while provider failures are infrastructure errors', () => {
  const raw = Buffer.from('{}');
  const format = summarizeRecord(
    { transport_attempts: 1, submission: { classification: 'format_fail' }, score: null },
    raw,
  );
  assert.equal(format.classification, 'format_fail');
  assert.equal(format.calibration_valid, true);
  const provider = summarizeRecord(
    { transport_attempts: 1, submission: { classification: 'provider_error' }, score: null },
    raw,
  );
  assert.equal(provider.calibration_valid, false);
});
