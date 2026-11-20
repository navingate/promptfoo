import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [version, captureDir] = process.argv.slice(2);
if (!/^v(?:4|5|6|7|8|9|10)$/u.test(version) || !captureDir) {
  throw new Error('Usage: node verify-capture.mjs <v4..v10> <capture-directory>');
}
const { buildCase, render, score, SYSTEM_PROMPT } = await import(`./${version}/chain.mjs`);
const sha256 = (filename) =>
  crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const freeze = JSON.parse(fs.readFileSync(path.join(captureDir, 'freeze.json'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(captureDir, 'results.json'), 'utf8'));
if (JSON.stringify(freeze) !== JSON.stringify(results.frozen)) {
  throw new Error('Freeze/result mismatch');
}
if (freeze.source_sha256 !== sha256(path.join(here, version, 'chain.mjs'))) {
  throw new Error('Source SHA-256 mismatch');
}
if (freeze.protocol_sha256 !== sha256(path.join(here, version, 'PROTOCOL.md'))) {
  throw new Error('Protocol SHA-256 mismatch');
}
for (const [key, value] of Object.entries(freeze)) {
  const match = key.match(/^upstream_(v\d+)_sha256$/u);
  if (match && value !== sha256(path.join(here, match[1], 'chain.mjs'))) {
    throw new Error(`${key} mismatch`);
  }
}
const tally = {
  exact: 0,
  task_failures: 0,
  invalid_outputs: 0,
  provider_or_transport_errors: 0,
  collateral_attempts: 0,
};
for (const record of results.records) {
  const base = path.join(captureDir, `case-${String(record.index).padStart(2, '0')}`);
  const testCase = buildCase(record.spec);
  const expectedPrompt = `${SYSTEM_PROMPT}\n\n${render(testCase)}\n\nDo not use tools. Answer the change request as the defender now.`;
  if (
    fs.readFileSync(`${base}.prompt.txt`, 'utf8') !== expectedPrompt ||
    sha256(`${base}.prompt.txt`) !== record.prompt_sha256
  ) {
    throw new Error(`Prompt mismatch at case ${record.index}`);
  }
  if (record.classification === 'provider_or_transport_error') {
    tally.provider_or_transport_errors += 1;
    continue;
  }
  if (sha256(`${base}.response.txt`) !== record.response_sha256) {
    throw new Error(`Response mismatch at case ${record.index}`);
  }
  let verdict;
  try {
    verdict = score(testCase, JSON.parse(fs.readFileSync(`${base}.response.txt`, 'utf8')));
  } catch {
    verdict = { valid: false, exact: false };
  }
  if (verdict.exact !== record.exact || verdict.valid !== record.valid) {
    throw new Error(`Score mismatch at case ${record.index}`);
  }
  if (verdict.exact) {
    tally.exact += 1;
  } else {
    tally.task_failures += 1;
  }
  if (!verdict.valid) {
    tally.invalid_outputs += 1;
  }
  tally.collateral_attempts += verdict.collateral_attempts ?? 0;
}
if (results.records.length !== freeze.case_indices.length) {
  throw new Error('Case count mismatch');
}
process.stdout.write(
  `${JSON.stringify({ version, cases: results.records.length, ...tally }, null, 2)}\n`,
);
