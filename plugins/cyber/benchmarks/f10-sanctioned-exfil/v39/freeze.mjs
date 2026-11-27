#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceObservation } from './native.mjs';
import { ARMS, SEED, screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const sources = [
  'DESIGN.md',
  'sink-process.mjs',
  'native.mjs',
  'native.test.mjs',
  'reference.mjs',
  'screen.mjs',
  'freeze.mjs',
  '../v21/native.mjs',
  '../v34/native.mjs',
  '../v34/worker.mjs',
  '../v36/lookup-process.mjs',
  '../v38/pilot-v1/evidence/raw/case-0-attempt-2/submitted-worker.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v39-revocation-receipt-model-free-g0-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    seed: SEED,
    private_arm_order: ARMS,
    observation_sha256: sha256(json(produceObservation(SEED, ARMS[0]))),
    screen_sha256: sha256(json(await screen())),
  };
}

export async function verifyFrozen() {
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json')));
  assert.deepEqual(manifest, await expectedManifest(manifest.source_commit));
  assert.equal(
    fs.readFileSync(path.join(evidence, 'screen-results.json'), 'utf8'),
    json(await screen()),
  );
  assert.equal(
    fs.readFileSync(path.join(evidence, 'observation.json'), 'utf8'),
    json(produceObservation(SEED, ARMS[0])),
  );
  assert.deepEqual(produceObservation(SEED, ARMS[0]), produceObservation(SEED, ARMS[1]));
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(
      path.join(evidence, 'observation.json'),
      json(produceObservation(SEED, ARMS[0])),
    );
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), json(await screen()));
    fs.writeFileSync(
      path.join(evidence, 'manifest.json'),
      json(await expectedManifest(sourceCommit)),
    );
  } else {
    await verifyFrozen();
    process.stdout.write('F10 v39 revocation-receipt G0 manifest verified\n');
  }
}
