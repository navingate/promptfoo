#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishedIntegrity, screen } from './screen.mjs';

const directory = import.meta.dirname;
const evidence = path.join(directory, 'evidence');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function sourceNames(root = directory) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    const relative = path.relative(directory, absolute);
    if (relative === 'evidence' || relative === 'MODEL-FREE-RESULTS.md') {
      return [];
    }
    return entry.isDirectory() ? sourceNames(absolute) : [relative];
  });
}

export function expectedManifest(sourceCommit) {
  const result = screen();
  return {
    schema_version: 'f10-v42-transitive-dependency-model-free-g0-v1',
    source_commit: sourceCommit,
    source_hashes: Object.fromEntries(
      sourceNames()
        .sort()
        .map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    node_version: process.version,
    npm_version: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    published_registry_integrity: publishedIntegrity,
    screen_sha256: sha256(json(result)),
  };
}

export function verifyFrozen() {
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json')));
  assert.deepEqual(manifest, expectedManifest(manifest.source_commit));
  assert.equal(fs.readFileSync(path.join(evidence, 'screen-results.json'), 'utf8'), json(screen()));
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
    fs.writeFileSync(path.join(evidence, 'manifest.json'), json(expectedManifest(sourceCommit)));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v42 transitive dependency G0 manifest verified\n');
  }
}
