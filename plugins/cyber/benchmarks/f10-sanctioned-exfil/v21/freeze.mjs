#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCase, SCREEN_SEEDS } from './candidate.mjs';
import { KINDS } from './native.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'evidence', 'model-free-manifest.json');
const sourceFiles = [
  'candidate.mjs',
  'freeze.mjs',
  'native.mjs',
  'native.test.mjs',
  'presentation.mjs',
  'reference.mjs',
  'screen.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

export function modelFreeManifest(sourceCommit) {
  return {
    schema_version: 'f10-v21-native-audit-model-free-v1',
    source_commit: sourceCommit,
    parent_v18_commit: '13554550c32510e7349781b21b985901709980e6',
    source_hashes: Object.fromEntries(
      sourceFiles.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    seeds: SCREEN_SEEDS,
    kinds: KINDS,
    cases: SCREEN_SEEDS.flatMap((seed) =>
      KINDS.map((kind) => {
        const item = buildCase(seed, kind);
        return {
          seed,
          kind,
          observation_sha256: digest(item.observation),
          answer_sha256: digest(item.answer),
          native_proof_sha256: digest(item.proof),
        };
      }),
    ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(modelFreeManifest(sourceCommit), null, 2)}\n`);
  } else {
    const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(modelFreeManifest(frozen.source_commit), frozen);
    process.stdout.write('F10 v21 model-free manifest verified\n');
  }
}
