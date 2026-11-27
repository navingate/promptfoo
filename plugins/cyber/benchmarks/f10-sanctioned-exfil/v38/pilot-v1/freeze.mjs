#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER } from './pilot.mjs';
import { screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const sources = [
  'README-public.md',
  'incident-public.json',
  'execute-child.mjs',
  'lookup-process.mjs',
  'sink-process.mjs',
  'public-check.mjs',
  'release-worker.mjs',
  'broker.mjs',
  'broker.test.mjs',
  'public-check.test.mjs',
  'pilot.mjs',
  'classify.mjs',
  'classify.test.mjs',
  'workdir.mjs',
  'workdir.test.mjs',
  'boundary.test.mjs',
  'screen.mjs',
  'run.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
  '../../v34/native.mjs',
  '../../v34/evidence/fixture.json',
  '../../v34/scorer.mjs',
  '../../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs',
  '../../v35/pilot-v1/evidence/raw/case-1-attempt-1/submitted-worker.mjs',
  '../../v36/sink-process.mjs',
  '../../v36/lookup-process.mjs',
  '../../v37/reference-worker.mjs',
  '../../v28/pilot-v1/events.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function expectedManifest(sourceCommit) {
  const resultScreen = await screen();
  return {
    schema_version: 'f10-v38-astra-remote-repair-pilot-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    screen_sha256: sha256(json(resultScreen)),
    answer_worker_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../../v37/reference-worker.mjs')),
    ),
    v34_fixture_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../../v34/evidence/fixture.json')),
    ),
    v34_scorer_sha256: sha256(fs.readFileSync(path.resolve(directory, '../../v34/scorer.mjs'))),
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
          ...Object.fromEntries(
            [
              'README-public.md',
              'execute-child.mjs',
              'incident-public.json',
              'lookup-process.mjs',
              'public-check.mjs',
              'release-worker.mjs',
              'sink-process.mjs',
            ].map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
          ),
          'context.json': sha256(context),
        },
      };
    }),
  };
}

export async function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(await expectedManifest(frozen.source_commit), frozen);
  assert.equal(
    fs.readFileSync(path.join(evidence, 'screen-results.json'), 'utf8'),
    json(await screen()),
  );
  assert.equal(
    fs.readFileSync(path.join(evidence, 'answer-worker.mjs'), 'utf8'),
    fs.readFileSync(path.resolve(directory, '../../v37/reference-worker.mjs'), 'utf8'),
  );
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(path.join(evidence, `input-${index}.txt`), 'utf8'), item.input);
    assert.equal(
      fs.readFileSync(path.join(evidence, `context-${index}.json`), 'utf8'),
      json(item.context),
    );
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
    fs.copyFileSync(
      path.resolve(directory, '../../v37/reference-worker.mjs'),
      path.join(evidence, 'answer-worker.mjs'),
    );
    for (const index of CASE_ORDER.map((_, slot) => slot)) {
      const item = buildPilotCase(index);
      fs.writeFileSync(path.join(evidence, `input-${index}.txt`), item.input);
      fs.writeFileSync(path.join(evidence, `context-${index}.json`), json(item.context));
    }
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), json(await screen()));
    fs.writeFileSync(manifestPath, json(await expectedManifest(sourceCommit)));
  } else {
    await verifyFrozen();
    process.stdout.write('F10 v38 remote repair pilot manifest verified\n');
  }
}
