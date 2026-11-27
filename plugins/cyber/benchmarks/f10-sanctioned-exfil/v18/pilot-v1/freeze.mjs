#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, PILOT_KINDS, PILOT_SEEDS } from './pilot.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'evidence', 'manifest.json');
const sourceRoot = path.resolve(directory, '..');
const sourceFiles = [
  '../native.mjs',
  '../reference.mjs',
  '../prompt.mjs',
  'pilot.mjs',
  'freeze.mjs',
  'screen.mjs',
  'run.mjs',
  'PROTOCOL.md',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = (name) => sha256(fs.readFileSync(path.resolve(directory, name)));
const artifact = (index, kind) => path.join(directory, 'evidence', `${kind}-${index}.json`);
const inputPath = (index) => path.join(directory, 'evidence', `input-${index}.txt`);

export function expectedManifest(sourceCommit) {
  const parentManifest = fs.readFileSync(path.join(sourceRoot, 'evidence', 'manifest.json'));
  return {
    schema_version: 'f10-v18-astra-pilot-v1',
    source_commit: sourceCommit,
    parent_v18_commit: '13554550c32510e7349781b21b985901709980e6',
    parent_v18_manifest_sha256: sha256(parentManifest),
    source_hashes: Object.fromEntries(sourceFiles.map((name) => [name, fileHash(name)])),
    pilot_indices: [0, 1],
    seeds: PILOT_SEEDS,
    kinds_per_case: PILOT_KINDS,
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    cases: [0, 1].map((index) => {
      const item = buildPilotCase(index);
      return {
        index,
        seed: item.seed,
        capture_count: item.observation.captures.length,
        flow_count: item.observation.flows.length,
        input_sha256: sha256(item.input),
        observation_sha256: sha256(JSON.stringify(item.observation)),
        answers_sha256: sha256(JSON.stringify(item.answers)),
        proofs_sha256: sha256(JSON.stringify(item.proofs)),
      };
    }),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(inputPath(index), 'utf8'), item.input);
    for (const [kind, value] of [
      ['observation', item.observation],
      ['answers', item.answers],
      ['proofs', item.proofs],
    ]) {
      assert.deepEqual(JSON.parse(fs.readFileSync(artifact(index, kind), 'utf8')), value);
    }
  }
  return frozen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    for (const index of [0, 1]) {
      const item = buildPilotCase(index);
      fs.writeFileSync(inputPath(index), item.input);
      for (const [kind, value] of [
        ['observation', item.observation],
        ['answers', item.answers],
        ['proofs', item.proofs],
      ]) {
        fs.writeFileSync(artifact(index, kind), `${JSON.stringify(value, null, 2)}\n`);
      }
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(expectedManifest(sourceCommit), null, 2)}\n`);
  } else {
    verifyFrozen();
    process.stdout.write('F10 v18 Astra pilot evidence verified\n');
  }
}
