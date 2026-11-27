#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER, gradeDefinition } from './pilot.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const sources = [
  '../native.mjs',
  '../view.mjs',
  '../view-tool.mjs',
  '../reference.mjs',
  '../scorer.mjs',
  'pilot.mjs',
  'pilot.test.mjs',
  'workdir.mjs',
  'workdir.test.mjs',
  'events.mjs',
  'events.test.mjs',
  'classify.mjs',
  'classify.test.mjs',
  'screen.mjs',
  'run.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);
const screenBytes = () => execFileSync(process.execPath, [path.join(directory, 'screen.mjs')]);
const bytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v28-astra-view-repair-pilot-v1',
    source_commit: sourceCommit,
    g0_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../evidence/manifest.json')),
    ),
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    screen_sha256: sha256(screenBytes()),
    case_order: CASE_ORDER,
    scoring_unit: 'one edited view replayed unchanged against both private futures',
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    sandbox: 'Codex custom managed permission profile with only staged view writable',
    cases: CASE_ORDER.map((_, index) => {
      const item = buildPilotCase(index);
      const staged = {
        'observation.json': sha256(bytes(item.observation)),
        'eligibility-view.json': sha256(bytes(item.deployed_view)),
        'view-tool.mjs': sha256(fs.readFileSync(path.resolve(directory, '../view-tool.mjs'))),
        'view.mjs': sha256(fs.readFileSync(path.resolve(directory, '../view.mjs'))),
      };
      return {
        index,
        seed: item.seed,
        input_sha256: sha256(item.input),
        staged_file_sha256: staged,
        answer_sha256: sha256(bytes(item.answer)),
        proof_sha256: sha256(bytes(item.proof)),
        private_futures_sha256: sha256(bytes(item.futures)),
      };
    }),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  assert.deepEqual(fs.readFileSync(path.join(evidence, 'screen-results.json')), screenBytes());
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(file(index, 'input'), 'utf8'), item.input);
    for (const kind of ['observation', 'deployed_view', 'answer', 'proof', 'futures']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(file(index, kind), 'utf8')), item[kind]);
    }
    assert.equal(gradeDefinition(item.seed, item.answer).exact, true);
    assert.equal(gradeDefinition(item.seed, item.deployed_view).exact, false);
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
    for (const index of CASE_ORDER.map((_, slot) => slot)) {
      const item = buildPilotCase(index);
      fs.writeFileSync(file(index, 'input'), item.input);
      for (const kind of ['observation', 'deployed_view', 'answer', 'proof', 'futures']) {
        fs.writeFileSync(file(index, kind), bytes(item[kind]));
      }
    }
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), screenBytes());
    fs.writeFileSync(manifestPath, bytes(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v28 Astra view repair pilot manifest verified\n');
  }
}
