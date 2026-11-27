#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase, verifyNativeProof } from './native.mjs';
import { decideFromObservation } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const family = path.dirname(directory);
const evidence = path.join(directory, 'evidence');
const sources = [
  'v26/G0-PROPOSAL.md',
  'v26/IMPLEMENTATION-PLAN.md',
  'v26/native.mjs',
  'v26/native.test.mjs',
  'v26/reference.mjs',
  'v26/scorer.mjs',
  'v26/screen.mjs',
  'v26/freeze.mjs',
  'v25/native.mjs',
  'v13/chain.mjs',
  'v13/estate.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const arms = ['early', 'late'];
const seed = 67001;

function expectedFixture() {
  return {
    schema_version: 'f10-v26-handover-g0-fixture-v1',
    seed,
    cases: arms.map((arm) => {
      const item = produceCase(seed, arm);
      assert.equal(verifyNativeProof(item.proof), true);
      const action = decideFromObservation(item.observation);
      const scored = scoreAction(seed, arm, action);
      assert.equal(scored.exact, true);
      return {
        arm,
        observation: item.observation,
        proof: item.proof,
        expected: item.answer,
        visible_reference_action: action,
        terminal: scored.terminal,
      };
    }),
  };
}

function screenBytes() {
  return execFileSync(process.execPath, [path.join(directory, 'screen.mjs')]);
}

function expectedManifest(sourceCommit, fixtureBytes, screenOutput) {
  return {
    schema_version: 'f10-v26-handover-g0-manifest-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.join(family, name)))]),
    ),
    fixture_sha256: sha256(fixtureBytes),
    screen_sha256: sha256(screenOutput),
    case_arms: arms,
    model_calls: 0,
  };
}

export function verifyFrozen() {
  const fixtureBytes = fs.readFileSync(path.join(evidence, 'fixture.json'));
  const screenOutput = fs.readFileSync(path.join(evidence, 'screen-results.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json'), 'utf8'));
  assert.deepEqual(JSON.parse(fixtureBytes), expectedFixture());
  assert.deepEqual(screenOutput, screenBytes());
  assert.deepEqual(manifest, expectedManifest(manifest.source_commit, fixtureBytes, screenOutput));
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    const fixtureBytes = Buffer.from(`${JSON.stringify(expectedFixture(), null, 2)}\n`);
    const screenOutput = screenBytes();
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'fixture.json'), fixtureBytes);
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), screenOutput);
    fs.writeFileSync(
      path.join(evidence, 'manifest.json'),
      `${JSON.stringify(expectedManifest(sourceCommit, fixtureBytes, screenOutput), null, 2)}\n`,
    );
  } else {
    verifyFrozen();
    process.stdout.write('F10 v26 handover G0 manifest verified\n');
  }
}
