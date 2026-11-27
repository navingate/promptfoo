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
const v40 = path.resolve(directory, '../../v40');
const sources = [
  'README-public.md',
  'assessment.json',
  'public-check.mjs',
  'audit-child.mjs',
  'evaluate.mjs',
  'pilot.mjs',
  'workdir.mjs',
  'preflight.mjs',
  'run.mjs',
  'screen.mjs',
  'pilot.test.mjs',
  'freeze.mjs',
  'PROTOCOL.md',
  '../../v28/pilot-v1/events.mjs',
  '../../v40/evidence/manifest.json',
  ...CASE_ORDER.flatMap((arm) =>
    ['ADVISORY.md', 'publisher.mjs', 'package.json', 'package-lock.json'].map(
      (name) => `../../v40/cases/${arm}/${name}`,
    ),
  ),
  ...['undici-5.26.1.tgz', 'undici-5.26.2.tgz', 'fastify-busboy-2.1.1.tgz'].map(
    (name) => `../../v40/artifacts/${name}`,
  ),
];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function verifyPublishedArtifacts() {
  const pins = JSON.parse(fs.readFileSync(path.join(v40, 'evidence/manifest.json')));
  for (const [name, integrity] of Object.entries(pins.published_registry_integrity)) {
    const bytes = fs.readFileSync(path.join(v40, 'artifacts', name));
    assert.equal(`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`, integrity);
    assert.equal(sha256(bytes), pins.source_hashes[`artifacts/${name}`]);
  }
  return pins.published_registry_integrity;
}

export async function expectedManifest(sourceCommit) {
  const published = verifyPublishedArtifacts();
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
    schema_version: 'f10-v41-undici-astra-diagnostic-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    published_registry_integrity: published,
    screen_sha256: sha256(json(await screen())),
    input_sha256: sha256(publicInput),
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    case_order: CASE_ORDER,
    cases,
  };
}

export async function verifyFrozen() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(await expectedManifest(manifest.source_commit), manifest);
  assert.equal(
    fs.readFileSync(path.join(evidence, 'screen-results.json'), 'utf8'),
    json(await screen()),
  );
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
    fs.writeFileSync(path.join(evidence, 'screen-results.json'), json(await screen()));
    fs.writeFileSync(path.join(evidence, 'input.txt'), publicInput);
    fs.writeFileSync(manifestPath, json(await expectedManifest(sourceCommit)));
  } else {
    await verifyFrozen();
    process.stdout.write('F10 v41 undici pilot manifest verified\n');
  }
}
