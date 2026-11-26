#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { replayMisses } from './historical-replay.mjs';
import { produceCase, verifyNativeProof } from './native.mjs';
import { auditEndToEnd } from './reference.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'evidence', 'manifest.json');
const sourceFiles = [
  'DESIGN.md',
  'HISTORICAL-REPLAY.md',
  'freeze.mjs',
  'historical-replay.mjs',
  'native.mjs',
  'native.test.mjs',
  'reference.mjs',
  'screen.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

export function manifest(sourceCommit) {
  const historical = replayMisses();
  const pair = [true, false].map((authorized) => produceCase(61001, authorized));
  for (const item of pair) {
    assert.equal(verifyNativeProof(item.proof), true);
    const audit = auditEndToEnd(item.visible);
    assert.deepEqual(audit.source_labels, item.answer.source_labels);
    assert.deepEqual(audit.downstream_labels, item.answer.downstream_labels);
  }
  return {
    schema_version: 'f10-v20-model-free-evidence-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sourceFiles.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    historical_replay_sha256: digest(historical),
    pair: pair.map((item, index) => ({
      downstream_grant_effective_at_delivery: index === 0,
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
    process.stdout.write('F10 v20 model-free manifest verified\n');
  }
}
