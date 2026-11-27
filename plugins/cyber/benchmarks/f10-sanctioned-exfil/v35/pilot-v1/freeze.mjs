#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER } from './pilot.mjs';
import { referenceWorkerSource, screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const screenPath = path.join(evidence, 'screen-results.json');
const answerPath = path.join(evidence, 'answer-worker.mjs');
const sources = [
  'README-public.md',
  'public-check.mjs',
  'release-worker.mjs',
  'pilot.mjs',
  'pilot.test.mjs',
  'evaluate.mjs',
  'evaluate.test.mjs',
  'boundary.test.mjs',
  'classify.mjs',
  'classify.test.mjs',
  'workdir.mjs',
  'workdir.test.mjs',
  'preflight.mjs',
  'screen.mjs',
  'run.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
  '../../v34/native.mjs',
  '../../v34/worker.mjs',
  '../../v34/reference.mjs',
  '../../v34/scorer.mjs',
  '../../v34/evidence/manifest.json',
  '../../v28/pilot-v1/events.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);

export function expectedManifest(sourceCommit) {
  const resultScreen = screen();
  return {
    schema_version: 'f10-v35-astra-worker-repair-pilot-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    v34_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../../v34/evidence/manifest.json')),
    ),
    v34_fixture_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../../v34/evidence/fixture.json')),
    ),
    v34_scorer_sha256: sha256(fs.readFileSync(path.resolve(directory, '../../v34/scorer.mjs'))),
    answer_worker_sha256: sha256(referenceWorkerSource()),
    screen_sha256: sha256(json(resultScreen)),
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    case_order: CASE_ORDER,
    cases: CASE_ORDER.map((_, index) => {
      const item = buildPilotCase(index);
      const context = json(item.context);
      return {
        index,
        seed: item.seed,
        input_sha256: sha256(item.input),
        context_sha256: sha256(context),
        staged_file_sha256: {
          'README-public.md': sha256(fs.readFileSync(path.join(directory, 'README-public.md'))),
          'context.json': sha256(context),
          'public-check.mjs': sha256(fs.readFileSync(path.join(directory, 'public-check.mjs'))),
          'release-worker.mjs': sha256(fs.readFileSync(path.join(directory, 'release-worker.mjs'))),
        },
      };
    }),
  };
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  assert.equal(fs.readFileSync(screenPath, 'utf8'), json(screen()));
  assert.equal(fs.readFileSync(answerPath, 'utf8'), referenceWorkerSource());
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(file(index, 'input'), 'utf8'), item.input);
    assert.equal(fs.readFileSync(file(index, 'context'), 'utf8'), json(item.context));
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
    fs.writeFileSync(answerPath, referenceWorkerSource());
    for (const index of CASE_ORDER.map((_, slot) => slot)) {
      const item = buildPilotCase(index);
      fs.writeFileSync(file(index, 'input'), item.input);
      fs.writeFileSync(file(index, 'context'), json(item.context));
    }
    fs.writeFileSync(screenPath, json(screen()));
    fs.writeFileSync(manifestPath, json(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v35 Astra worker-repair pilot manifest verified\n');
  }
}
