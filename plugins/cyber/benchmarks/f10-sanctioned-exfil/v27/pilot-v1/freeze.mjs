#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const sources = [
  '../guard.mjs',
  '../native.mjs',
  '../reference.mjs',
  '../scorer.mjs',
  'pilot.mjs',
  'pilot.test.mjs',
  'classify.mjs',
  'classify.test.mjs',
  'workdir.mjs',
  'workdir.test.mjs',
  'screen.mjs',
  'run.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
  '../../v25/pilot-v1/event-validation.mjs',
  '../../v25/pilot-v1/event-validation.test.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);
const screenBytes = () => execFileSync(process.execPath, [path.join(directory, 'screen.mjs')]);

export function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v27-astra-guard-pilot-v1',
    source_commit: sourceCommit,
    g0_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../evidence/manifest.json')),
    ),
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    screen_sha256: sha256(screenBytes()),
    case_order: CASE_ORDER,
    scoring_unit: 'one installation response replayed unchanged against both private futures',
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    cases: CASE_ORDER.map((_, index) => {
      const item = buildPilotCase(index);
      return {
        index,
        seed: item.seed,
        input_sha256: sha256(item.input),
        observation_sha256: sha256(JSON.stringify(item.observation)),
        answer_sha256: sha256(JSON.stringify(item.answer)),
        proof_sha256: sha256(JSON.stringify(item.proof)),
        private_futures_sha256: sha256(JSON.stringify(item.futures)),
        native_stages_at_entry: item.observation.stage_manifests.length,
        authored_prior_receipts_at_entry: item.observation.prior_recipient_receipts.length,
        authored_held_chunks_at_entry: Number(item.observation.prior_held_chunk.state === 'held'),
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
    for (const kind of ['observation', 'answer', 'proof', 'futures']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(file(index, kind), 'utf8')), item[kind]);
    }
    const reference = gradeResponse(JSON.stringify(item.answer), item.seed);
    assert.equal(reference.valid, true);
    assert.equal(reference.exact, true);
    assert.equal(reference.futures.early.exact, true);
    assert.equal(reference.futures.late.exact, true);
    const noAction = gradeResponse('{}', item.seed);
    assert.equal(noAction.valid, true);
    assert.equal(noAction.exact, false);
    assert.equal(gradeResponse('{"pause_publisher":true}', item.seed).exact, false);
    assert.equal(gradeResponse('{"pause_publisher":"yes"}', item.seed).valid, false);
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
      for (const kind of ['observation', 'answer', 'proof', 'futures']) {
        fs.writeFileSync(file(index, kind), `${JSON.stringify(item[kind], null, 2)}\n`);
      }
    }
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), screenBytes());
    fs.writeFileSync(manifestPath, `${JSON.stringify(expectedManifest(sourceCommit), null, 2)}\n`);
  } else {
    verifyFrozen();
    process.stdout.write('F10 v27 Astra guard pilot manifest verified\n');
  }
}
