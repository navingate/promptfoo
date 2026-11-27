#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(directory, 'evidence');
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
const kinds = ['assigned-first', 'assigned-last', 'assigned-all'];

function expectedFixture() {
  return {
    schema_version: 'f10-v25-mixed-authority-g0-fixture-v1',
    seed: 64007,
    cases: kinds.map((kind) => {
      const item = produceCase(64007, kind);
      assert.equal(verifyNativeProof(item.proof), true);
      const action = respond(item.observation);
      const scored = scoreAction(64007, kind, action);
      assert.equal(scored.exact, true);
      return {
        kind,
        observation: item.observation,
        native_proof: item.proof,
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
    schema_version: 'f10-v25-mixed-authority-g0-manifest-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    fixture_sha256: sha256(fixtureBytes),
    screen_sha256: sha256(screenOutput),
    case_kinds: kinds,
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
    process.stdout.write('F10 v25 mixed-authority G0 manifest verified\n');
  }
}
