#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BATCH_COUNT, buildBatch } from './candidate.mjs';
import { DEFENSE_PROMPT } from './prompt.mjs';
import { modelFreeScreen } from './screen.mjs';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));

export function freezeCandidate(
  destination,
  sourceCommit,
  indices = Array.from({ length: BATCH_COUNT }, (_, i) => i),
) {
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
    throw new Error('source commit must be a full Git SHA');
  }
  if (fs.existsSync(destination)) {
    throw new Error('evidence destination already exists');
  }
  const screen = modelFreeScreen();
  if (
    screen.reference.exact !== BATCH_COUNT ||
    Object.values(screen.shortcuts).some((item) => item.exact === BATCH_COUNT)
  ) {
    throw new Error('model-free gate failed');
  }
  fs.mkdirSync(destination, { recursive: false });
  const files = [];
  const write = (name, value) => {
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx' });
    files.push({ path: name, sha256: hash(bytes) });
  };
  for (const index of indices) {
    const batch = buildBatch(index);
    write(`observation-${index}.json`, { captures: batch.captures, flows: batch.flows });
    write(`answers-${index}.json`, {
      index,
      cap_seed: batch.capSeed,
      overlap_seed: batch.overlapSeed,
      labels: batch.labels,
    });
    write(`proof-${index}.json`, { index, proofs: batch.proofs });
  }
  const manifest = {
    schema_version: 'f10-v17-frozen-evidence-v1',
    source_commit: sourceCommit,
    prompt_sha256: hash(DEFENSE_PROMPT),
    batch_indices: indices,
    files,
    model_free_screen: screen,
  };
  fs.writeFileSync(
    path.join(destination, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sourceCommit = process.argv[2];
  const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (sourceCommit !== current) {
    throw new Error('source commit differs from checkout HEAD');
  }
  const destination = process.argv[3] ?? path.join(here, 'evidence');
  const manifest = freezeCandidate(destination, sourceCommit);
  process.stdout.write(`${destination} ${manifest.files.length} files\n`);
}
