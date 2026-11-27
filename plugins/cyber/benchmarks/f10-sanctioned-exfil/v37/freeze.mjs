#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicIncident } from './incident.mjs';
import { screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const screenPath = path.join(evidence, 'screen-results.json');
const incidentPath = path.join(directory, 'incident-public.json');
const sources = [
  'DESIGN.md',
  'README-public.md',
  'release-worker.mjs',
  'reference-worker.mjs',
  'adapter.mjs',
  'adapter.test.mjs',
  'public-check.mjs',
  'public-check.test.mjs',
  'incident.mjs',
  'incident-public.json',
  'screen.mjs',
  'freeze.mjs',
  '../v36/sink-process.mjs',
  '../v36/lookup-process.mjs',
  '../v34/native.mjs',
  '../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs',
  '../v35/pilot-v1/evidence/raw/case-1-attempt-1/submitted-worker.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function expectedManifest(sourceCommit, screenBytes, incidentBytes) {
  return {
    schema_version: 'f10-v37-uncoached-remote-worker-model-free-freeze-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    screen_sha256: sha256(screenBytes),
    public_incident_sha256: sha256(incidentBytes),
    model_calls: 0,
  };
}

export async function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const currentScreen = json(await screen());
  const currentIncident = json(await publicIncident());
  assert.equal(fs.readFileSync(screenPath, 'utf8'), currentScreen);
  assert.equal(fs.readFileSync(incidentPath, 'utf8'), currentIncident);
  assert.deepEqual(expectedManifest(frozen.source_commit, currentScreen, currentIncident), frozen);
  return frozen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    const currentScreen = json(await screen());
    const currentIncident = json(await publicIncident());
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(screenPath, currentScreen);
    fs.writeFileSync(incidentPath, currentIncident);
    fs.writeFileSync(
      manifestPath,
      json(expectedManifest(sourceCommit, currentScreen, currentIncident)),
    );
  } else {
    await verifyFrozen();
    process.stdout.write('F10 v37 uncoached remote-worker G0 manifest verified\n');
  }
}
