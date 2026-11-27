#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const screenPath = path.join(evidence, 'screen-results.json');
const sources = [
  'DESIGN.md',
  'sink-process.mjs',
  'lookup-process.mjs',
  'cross-request.mjs',
  'cross-request.test.mjs',
  'two-store.mjs',
  'two-store.test.mjs',
  'screen.mjs',
  'freeze.mjs',
  '../v34/native.mjs',
  '../v34/evidence/manifest.json',
  '../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function expectedManifest(sourceCommit, screenBytes) {
  return {
    schema_version: 'f10-v36-two-store-model-free-freeze-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    screen_sha256: sha256(screenBytes),
    native_scope: 'v13 source and DOB ETL through frozen v34 replay',
    authored_scope: 'two SQLite durability domains, recipient service and lost-ACK scheduler',
    model_calls: 0,
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = json(screen());
  assert.equal(fs.readFileSync(screenPath, 'utf8'), current);
  assert.deepEqual(expectedManifest(frozen.source_commit, current), frozen);
  return frozen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    const current = json(screen());
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(screenPath, current);
    fs.writeFileSync(manifestPath, json(expectedManifest(sourceCommit, current)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v36 two-store model-free manifest verified\n');
  }
}
