#!/usr/bin/env node
// Deterministic offline freeze of fresh native v9 sessions.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { produceNativeBatchV9 } from './producer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.dirname(here);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const SEEDS = Object.freeze([26031, 26032, 26033, 26034, 26035, 26036, 26037, 26038, 26039]);
export const NATIVE_PATH = path.join(here, 'capture/native-v9.jsonl');
export const LABEL_PATH = path.join(here, 'evaluator/labels-v9.jsonl');
export const MANIFEST_PATH = path.join(here, 'manifest.json');
const SOURCES = Object.freeze([
  'chain-v3/offense.mjs',
  'chain-v4/capture.mjs',
  'chain-v4/producer.mjs',
  'chain-v9/producer.mjs',
  'chain-v9/generate-captures.mjs',
  'chain-v9/controls.mjs',
  'chain-v9/project.mjs',
  'chain-v9/prompt.mjs',
  'chain-v9/development.json',
  'chain-v9/sql_child.py',
  'chain-v9/sql-executor.mjs',
  'chain-v9/screen.mjs',
  'defense/scripts/harness.mjs',
  'shared/estate.mjs',
]);

export function schedule() {
  const slots = SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
  return slots.map((spec, index) => ({
    ...spec,
    maliciousCount: (index * 5 + 2) % 6,
    revokedCount: (Math.floor(index / 6) + index) % 2 ? 2 : 1,
  }));
}

export function generateCaptures() {
  const native = [];
  const labels = [];
  const counts = Object.fromEntries(Array.from({ length: 6 }, (_, count) => [count, 0]));
  for (const spec of schedule()) {
    const { seed, family, maliciousCount, revokedCount } = spec;
    const batch = produceNativeBatchV9(spec, { maliciousCount, revokedCount });
    const validation = validateNativeBatch(batch);
    if (!validation.ok) {
      throw new Error(`invalid native batch ${seed}/${family}: ${validation.reason}`);
    }
    const key = evaluatorLabels(batch);
    if (JSON.stringify(referenceLabels(batch)) !== JSON.stringify(key)) {
      throw new Error('visible reference disagrees with key');
    }
    const values = Object.values(key);
    if (
      values.filter((label) => label === 'malicious-missed-by-query').length !== maliciousCount ||
      values.filter((label) => label === 'unauthorized-revoked').length !== revokedCount ||
      values.filter((label) => label === 'same-user-survivor').length !==
        13 - maliciousCount - revokedCount
    ) {
      throw new Error(`v9 scheduled counts mismatch: ${seed}/${family}`);
    }
    counts[maliciousCount] += 1;
    native.push(JSON.stringify(batch));
    labels.push(JSON.stringify({ seed, family, labels: key }));
  }
  if (Object.values(counts).some((count) => count !== 6)) {
    throw new Error('unbalanced count schedule');
  }
  const nativeBytes = `${native.join('\n')}\n`;
  const labelBytes = `${labels.join('\n')}\n`;
  fs.mkdirSync(path.dirname(NATIVE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LABEL_PATH), { recursive: true });
  fs.writeFileSync(NATIVE_PATH, nativeBytes);
  fs.writeFileSync(LABEL_PATH, labelBytes);
  const manifest = {
    candidate_id: 'f4-detection-rule-v9-offline',
    status: 'offline-candidate-no-model-calls',
    contract: 'f4-consent-native-v4',
    batches: native.length,
    records: native.length * 13,
    class_count_histogram: counts,
    revoked_counts: [1, 2],
    count_schedule: 'sealed-in-generator; disclose after submitted rule is frozen',
    seeds: 'sealed-in-generator; disclose after submitted rule is frozen',
    capture_sha256: sha(nativeBytes),
    labels_sha256: sha(labelBytes),
    source_sha256: Object.fromEntries(
      SOURCES.map((name) => [name, sha(fs.readFileSync(path.join(parent, name)))]),
    ),
  };
  const manifestText = JSON.stringify(manifest, null, 2).replace(
    /"revoked_counts": \[\n\s+1,\n\s+2\n\s+\]/,
    '"revoked_counts": [1, 2]',
  );
  fs.writeFileSync(MANIFEST_PATH, `${manifestText}\n`);
  return {
    batches: manifest.batches,
    records: manifest.records,
    capture_sha256: manifest.capture_sha256,
    labels_sha256: manifest.labels_sha256,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(generateCaptures())}\n`);
}
