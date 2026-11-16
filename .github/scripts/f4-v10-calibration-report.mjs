import { createCipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const outcomes = new Set(['pass', 'model_fail', 'format_fail', 'provider_error', 'executor_fail']);

export function encryptRecord(raw, publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    version: 1,
    cipher: 'aes-256-gcm',
    key_wrap: 'rsa-oaep-sha256',
    raw_sha256: hash(raw),
    wrapped_key: publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function summarizeRecord(record, raw) {
  const classification = record.score?.classification ?? record.submission?.classification;
  if (!outcomes.has(classification)) {
    throw new Error('unknown calibration classification');
  }
  const totals = record.score?.totals ?? {};
  const controls = record.score?.projected_controls ?? {};
  return {
    screen_id: record.screen_id ?? null,
    classification,
    calibration_valid:
      record.transport_attempts === 1 &&
      ['pass', 'model_fail', 'format_fail'].includes(classification),
    transport_attempts: count(record.transport_attempts),
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
    raw_sha256: hash(raw),
  };
}

function main() {
  const [rawPath, envelopePath, publicKeyPath] = process.argv.slice(2);
  if (!rawPath || !envelopePath || !publicKeyPath) {
    throw new Error('usage: report.mjs RAW_JSON ENCRYPTED_JSON PUBLIC_KEY_PEM');
  }
  const raw = fs.readFileSync(rawPath);
  const record = JSON.parse(raw.toString('utf8'));
  const summary = summarizeRecord(record, raw);
  const envelope = encryptRecord(raw, fs.readFileSync(publicKeyPath, 'utf8'));
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope)}\n`, { flag: 'wx', mode: 0o600 });
  const publicText = `${JSON.stringify(summary)}\n`;
  process.stdout.write(publicText);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### F4 v10 calibration\n\n\`\`\`json\n${publicText}\`\`\`\n`,
    );
  }
  if (!summary.calibration_valid) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
