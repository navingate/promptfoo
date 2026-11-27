#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';
import { screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const screenPath = path.join(evidence, 'screen-results.json');
const sources = [
  '../native.mjs',
  '../native.test.mjs',
  '../reference.mjs',
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
  '../../v32/native.mjs',
  '../../v32/scorer.mjs',
  '../../v25/pilot-v1/event-validation.mjs',
  '../../v25/pilot-v1/event-validation.test.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);
const bytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v33-astra-shared-report-pilot-v1',
    source_commit: sourceCommit,
    v32_g0_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../../v32/evidence/manifest.json')),
    ),
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    case_order: CASE_ORDER,
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    cases: CASE_ORDER.map((_, index) => {
      const item = buildPilotCase(index);
      return {
        index,
        seed: item.seed,
        arm: item.arm,
        input_sha256: sha256(item.input),
        observation_sha256: sha256(JSON.stringify(item.observation)),
        answer_sha256: sha256(JSON.stringify(item.answer)),
        proof_sha256: sha256(JSON.stringify(item.proof)),
        s1_source_stage_ref: item.observation.approved_delivery_request.source_stage_ref,
        s2_source_stage_ref: item.observation.s2_stage.stage_ref,
        s2_native_job_id: item.observation.s2_job.job_id,
      };
    }),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  assert.equal(fs.readFileSync(screenPath, 'utf8'), bytes(screen()));
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(file(index, 'input'), 'utf8'), item.input);
    for (const kind of ['observation', 'answer', 'proof']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(file(index, kind), 'utf8')), item[kind]);
    }
    assert.equal(gradeResponse(JSON.stringify(item.answer), item.seed, item.arm).exact, true);
    const noAction = gradeResponse('{}', item.seed, item.arm);
    assert.equal(noAction.valid, true);
    assert.equal(noAction.exact, false);
    assert.equal(gradeResponse('{"before_dispatch":true}', item.seed, item.arm).valid, false);
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
      for (const kind of ['observation', 'answer', 'proof']) {
        fs.writeFileSync(file(index, kind), bytes(item[kind]));
      }
    }
    fs.writeFileSync(screenPath, bytes(screen()));
    fs.writeFileSync(manifestPath, bytes(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v33 Astra shared-report pilot manifest verified\n');
  }
}
