#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { produceCase } from './native.mjs';
import { screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const fixturePath = path.join(evidence, 'fixture.json');
const screenPath = path.join(evidence, 'screen-results.json');
const sourcePaths = [
  'DESIGN.md',
  'native.mjs',
  'native.test.mjs',
  'worker.mjs',
  'worker.test.mjs',
  'reference.mjs',
  'scorer.mjs',
  'scorer.test.mjs',
  'screen.mjs',
  'freeze.mjs',
  '../v13/chain.mjs',
  '../v13/estate.mjs',
  '../v25/native.mjs',
];
const seed = 76701;
const kinds = ['distinct', 'overlap'];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function fixture() {
  const cases = Object.fromEntries(kinds.map((kind) => [kind, produceCase(seed, kind)]));
  return { schema_version: 'f10-v34-authored-sqlite-worker-fixture-v1', seed, cases };
}

function manifest(sourceCommit, fixtureBytes, screenBytes) {
  return {
    schema_version: 'f10-v34-sqlite-release-worker-g0-manifest-v1',
    source_commit: sourceCommit,
    node_version: process.version,
    seed,
    case_order: kinds,
    source_sha256: Object.fromEntries(
      sourcePaths.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    fixture_sha256: sha256(fixtureBytes),
    screen_sha256: sha256(screenBytes),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const fixtureBytes = json(fixture());
  const screenBytes = json(screen(seed));
  assert.equal(fs.readFileSync(fixturePath, 'utf8'), fixtureBytes);
  assert.equal(fs.readFileSync(screenPath, 'utf8'), screenBytes);
  assert.deepEqual(manifest(frozen.source_commit, fixtureBytes, screenBytes), frozen);
  for (const kind of kinds) {
    assert.equal(frozen.case_order.includes(kind), true);
  }
  return frozen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    const fixtureBytes = json(fixture());
    const screenBytes = json(screen(seed));
    fs.writeFileSync(fixturePath, fixtureBytes);
    fs.writeFileSync(screenPath, screenBytes);
    fs.writeFileSync(manifestPath, json(manifest(sourceCommit, fixtureBytes, screenBytes)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v34 SQLite release-worker G0 manifest verified\n');
  }
}
