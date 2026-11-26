#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase, verifyNativeProof } from './native.mjs';
import { detect } from './reference.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'evidence', 'manifest.json');
const sourceFiles = [
  'DESIGN.md',
  'freeze.mjs',
  'native.mjs',
  'native.test.mjs',
  'reference.mjs',
  'screen.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

export function manifest(sourceCommit) {
  const pair = [true, false].map((validDelegation) => produceCase(61001, validDelegation));
  for (const item of pair) {
    assert.equal(verifyNativeProof(item.proof), true);
    assert.deepEqual(detect(item.visible), item.answer.labels);
  }
  return {
    schema_version: 'f10-v19-one-pair-model-free-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sourceFiles.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    pair: pair.map((item, index) => ({
      delegated_at_issue: index === 0,
      observation_sha256: digest(item.visible),
      answer_sha256: digest(item.answer),
      native_proof_sha256: digest(item.proof),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest(sourceCommit), null, 2)}\n`);
    process.stdout.write(`${manifestPath}\n`);
  } else {
    const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest(frozen.source_commit), frozen);
    process.stdout.write('F10 v19 model-free pair manifest verified\n');
  }
}
