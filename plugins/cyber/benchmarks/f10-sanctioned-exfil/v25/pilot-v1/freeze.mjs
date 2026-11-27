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
  '../native.mjs',
  '../reference.mjs',
  '../scorer.mjs',
  'pilot.mjs',
  'freeze.mjs',
  'screen.mjs',
  'run.mjs',
  'PROTOCOL.md',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);

export function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v25-astra-projection-pilot-v1',
    source_commit: sourceCommit,
    g0_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../evidence/manifest.json')),
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
        kind: item.kind,
        input_sha256: sha256(item.input),
        observation_sha256: sha256(JSON.stringify(item.observation)),
        answer_sha256: sha256(JSON.stringify(item.answer)),
        proof_sha256: sha256(JSON.stringify(item.proof)),
        native_stages_at_entry: item.observation.stage_manifests.length,
      };
    }),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(file(index, 'input'), 'utf8'), item.input);
    for (const kind of ['observation', 'answer', 'proof']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(file(index, kind), 'utf8')), item[kind]);
    }
    assert.equal(gradeResponse(JSON.stringify(item.answer), item.seed, item.kind).exact, true);
    const wrongRecipient = {
      ...item.answer,
      deliveries: item.answer.deliveries.map((delivery) => ({
        ...delivery,
        recipient_id: 'different-recipient',
      })),
    };
    const wrongGrade = gradeResponse(JSON.stringify(wrongRecipient), item.seed, item.kind);
    assert.equal(wrongGrade.valid, true);
    assert.equal(wrongGrade.exact, false);
    const duplicate = {
      ...item.answer,
      deliveries: [item.answer.deliveries[0], item.answer.deliveries[0]],
    };
    const duplicateGrade = gradeResponse(JSON.stringify(duplicate), item.seed, item.kind);
    assert.equal(duplicateGrade.valid, true);
    assert.equal(duplicateGrade.exact, false);
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
    for (const { index } of CASE_ORDER.map((_, index) => ({ index }))) {
      const item = buildPilotCase(index);
      fs.writeFileSync(file(index, 'input'), item.input);
      for (const kind of ['observation', 'answer', 'proof']) {
        fs.writeFileSync(file(index, kind), `${JSON.stringify(item[kind], null, 2)}\n`);
      }
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(expectedManifest(sourceCommit), null, 2)}\n`);
  } else {
    verifyFrozen();
    process.stdout.write('F10 v25 Astra projection pilot manifest verified\n');
  }
}
