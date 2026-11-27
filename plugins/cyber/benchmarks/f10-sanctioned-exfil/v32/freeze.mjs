#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase, verifyNativeProof } from './native.mjs';
import { SEED, screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const fixturePath = path.join(evidence, 'fixture.json');
const screenPath = path.join(evidence, 'screen-results.json');
const manifestPath = path.join(evidence, 'manifest.json');
const sources = [
  'G0-PROPOSAL.md',
  'IMPLEMENTATION-PLAN.md',
  'native.mjs',
  'native.test.mjs',
  'reference.mjs',
  'scorer.mjs',
  'screen.mjs',
  'freeze.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fixture() {
  const a = produceCase(SEED, 'a');
  const b = produceCase(SEED, 'b');
  assert.deepEqual(a.proof, b.proof);
  assert.equal(verifyNativeProof(a.proof), true);
  const withoutVariable = (observation) => {
    const copy = structuredClone(observation);
    copy.signed_s2_assignment.assigned_account_ids = null;
    return copy;
  };
  assert.deepEqual(withoutVariable(a.observation), withoutVariable(b.observation));
  assert.deepEqual(a.observation.s2_job, b.observation.s2_job);
  assert.deepEqual(a.observation.s2_stage, b.observation.s2_stage);
  return {
    schema_version: 'f10-v32-shared-report-fixture-v1',
    observations: { a: a.observation, b: b.observation },
    native_source_and_queue_proof: a.proof,
  };
}

function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v32-shared-report-manifest-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    fixture_sha256: sha256(bytes(fixture())),
    screen_sha256: sha256(bytes(screen())),
    matched_pairs: 1,
    model_calls: 0,
  };
}

export function verifyFrozen() {
  const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(saved, expectedManifest(saved.source_commit));
  assert.equal(fs.readFileSync(fixturePath, 'utf8'), bytes(fixture()));
  assert.equal(fs.readFileSync(screenPath, 'utf8'), bytes(screen()));
  return saved;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(fixturePath, bytes(fixture()));
    fs.writeFileSync(screenPath, bytes(screen()));
    fs.writeFileSync(manifestPath, bytes(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v32 shared-report G0 manifest verified\n');
  }
}
