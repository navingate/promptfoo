#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASE_ORDER, publicInput, sha256 } from './pilot.mjs';
import { screen } from './screen.mjs';
import { createDirectories, stageCase } from './workdir.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const v42 = path.resolve(directory, '../../v42');
const prior = JSON.parse(fs.readFileSync(path.join(v42, 'evidence/manifest.json')));
const localSources = [
  'README-public.md',
  'assessment.json',
  'public-check.cjs',
  'evaluate.mjs',
  'evaluate.test.mjs',
  'environment.mjs',
  'environment.test.mjs',
  'pilot.mjs',
  'preflight.mjs',
  'workdir.mjs',
  'workdir.test.mjs',
  'screen.mjs',
  'screen.test.mjs',
  'run-state.mjs',
  'run-state.test.mjs',
  'run.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
];
const inheritedSources = [
  '../../v28/pilot-v1/events.mjs',
  '../../v41/pilot-v1/ledger.mjs',
  '../../v42/evidence/manifest.json',
  '../../v42/registry-integrity.json',
  '../../v42/publisher.cjs',
  '../../v42/benign-check.cjs',
  ...CASE_ORDER.flatMap((arm) =>
    [
      'ADVISORY.md',
      'package.json',
      'package-lock.json',
      'worker/package.json',
      'worker/package-lock.json',
      'worker/publisher.cjs',
      'worker/benign-check.cjs',
    ].map((name) => `../../v42/cases/${arm}/workspace/${name}`),
  ),
  ...Object.keys(prior.published_registry_integrity).map((name) => `../../v42/artifacts/${name}`),
];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function verifyPublishedArtifacts() {
  for (const [name, integrity] of Object.entries(prior.published_registry_integrity)) {
    const bytes = fs.readFileSync(path.join(v42, 'artifacts', name));
    assert.equal(`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`, integrity);
    assert.equal(sha256(bytes), prior.source_hashes[`artifacts/${name}`]);
  }
  return prior.published_registry_integrity;
}

export function expectedManifest(sourceCommit) {
  const cases = [];
  for (let index = 0; index < CASE_ORDER.length; index += 1) {
    const { modelRoot, rawDirectory } = createDirectories();
    try {
      cases.push({ index, staged: stageCase(modelRoot, index).hashes });
    } finally {
      fs.rmSync(modelRoot, { recursive: true, force: true });
      fs.rmSync(rawDirectory, { recursive: true, force: true });
    }
  }
  return {
    schema_version: 'f10-v43-follow-redirects-astra-diagnostic-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      [...localSources, ...inheritedSources].map((name) => [
        name,
        sha256(fs.readFileSync(path.resolve(directory, name))),
      ]),
    ),
    published_registry_integrity: verifyPublishedArtifacts(),
    screen_sha256: sha256(json(screen())),
    input_sha256: sha256(publicInput),
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    node_version: process.version,
    npm_version: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    case_order: CASE_ORDER,
    cases,
  };
}

export function verifyFrozen() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(manifest.source_commit), manifest);
  assert.equal(fs.readFileSync(path.join(evidence, 'screen-results.json'), 'utf8'), json(screen()));
  assert.equal(fs.readFileSync(path.join(evidence, 'input.txt'), 'utf8'), publicInput);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), json(screen()));
    fs.writeFileSync(path.join(evidence, 'input.txt'), publicInput);
    fs.writeFileSync(manifestPath, json(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v43 follow-redirects pilot manifest verified\n');
  }
}
