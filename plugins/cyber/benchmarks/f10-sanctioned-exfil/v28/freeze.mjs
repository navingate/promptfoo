#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase, replayView, verifyNativeProof } from './native.mjs';
import { repairFromObservation } from './reference.mjs';
import { scoreRepair } from './scorer.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const family = path.dirname(directory);
const evidence = path.join(directory, 'evidence');
const seed = 71001;
const arms = ['early', 'late'];
const sources = [
  'v28/G0-PROPOSAL.md',
  'v28/IMPLEMENTATION-PLAN.md',
  'v28/view.mjs',
  'v28/view-tool.mjs',
  'v28/view-tool.test.mjs',
  'v28/native.mjs',
  'v28/native.test.mjs',
  'v28/reference.mjs',
  'v28/scorer.mjs',
  'v28/screen.mjs',
  'v28/freeze.mjs',
  'v25/native.mjs',
  'v13/chain.mjs',
  'v13/estate.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function expectedFixture() {
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  const onlyEffectiveTime = structuredClone(early.future);
  onlyEffectiveTime.amendment.effective_at = late.future.amendment.effective_at;
  assert.deepEqual(onlyEffectiveTime, late.future);
  assert.equal(verifyNativeProof(early.proof), true);
  const reference = repairFromObservation(early.observation);
  assert.equal(scoreRepair(seed, reference).exact, true);
  return {
    schema_version: 'f10-v28-eligibility-repair-g0-fixture-v1',
    seed,
    observation: early.observation,
    proof: early.proof,
    deployed_view: early.observation.deployed_view,
    visible_reference_repair: reference,
    cases: arms.map((arm) => {
      const item = arm === 'early' ? early : late;
      return {
        arm,
        private_future: item.future,
        expected: item.expected,
        old_view_terminal: replayView(seed, arm, early.observation.deployed_view),
        repaired_terminal: replayView(seed, arm, reference),
      };
    }),
  };
}

function screenBytes() {
  return execFileSync(process.execPath, [path.join(directory, 'screen.mjs')]);
}

function expectedManifest(sourceCommit, fixtureBytes, screenOutput) {
  return {
    schema_version: 'f10-v28-eligibility-repair-g0-manifest-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.join(family, name)))]),
    ),
    fixture_sha256: sha256(fixtureBytes),
    screen_sha256: sha256(screenOutput),
    model_case_count: 1,
    future_histories_per_definition: 2,
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
    process.stdout.write('F10 v28 eligibility repair G0 manifest verified\n');
  }
}
