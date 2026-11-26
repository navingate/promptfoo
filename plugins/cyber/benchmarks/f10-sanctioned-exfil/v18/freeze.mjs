#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BATCH_COUNT, buildBatch } from './candidate.mjs';
import { DEFENSE_PROMPT } from './prompt.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'evidence', 'manifest.json');
const sourceFiles = [
  'DESIGN.md',
  'candidate.mjs',
  'freeze.mjs',
  'native.mjs',
  'native.test.mjs',
  'prompt.mjs',
  'reference.mjs',
  'screen.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

export function manifest(sourceCommit) {
  return {
    schema_version: 'f10-v18-model-free-regression-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sourceFiles.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    prompt_sha256: sha256(DEFENSE_PROMPT),
    batches: Array.from({ length: BATCH_COUNT }, (_, index) => {
      const batch = buildBatch(index);
      return {
        index,
        seed: batch.seed,
        capture_count: batch.captures.length,
        flow_count: batch.flows.length,
        observations_sha256: digest(batch.captures),
        answers_sha256: digest(batch.labels),
        native_proofs_sha256: digest(batch.proofs),
      };
    }),
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
    process.stdout.write('F10 v18 model-free manifest verified\n');
  }
}
