#!/usr/bin/env node
// Reproducible, producer-owned fixture freeze. Evaluator labels are a separate file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { evaluatorLabels, referenceLabels } from './capture.mjs';
import { produceNativeBatch } from './producer.mjs';

export const CAPTURE_SEEDS = Object.freeze([
  11021, 11022, 11023, 11024, 11025, 11026, 11027, 11028, 11029,
]);
const here = path.dirname(fileURLToPath(import.meta.url));
export const NATIVE_PATH = path.join(here, 'capture', 'native-v4.jsonl');
export const LABEL_PATH = path.join(here, 'evaluator', 'labels-v4.jsonl');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function generateCaptures() {
  const native = [];
  const labels = [];
  for (const seed of CAPTURE_SEEDS) {
    for (const family of FAMILIES) {
      const batch = produceNativeBatch({ seed, family });
      const key = evaluatorLabels(batch);
      const reference = referenceLabels(batch);
      if (JSON.stringify(key) !== JSON.stringify(reference)) {
        throw new Error(`F4 captured reference disagrees with evaluator: ${seed}/${family}`);
      }
      native.push(JSON.stringify(batch));
      labels.push(JSON.stringify({ seed, family, labels: key }));
    }
  }
  const nativeBytes = `${native.join('\n')}\n`;
  const labelBytes = `${labels.join('\n')}\n`;
  fs.mkdirSync(path.dirname(NATIVE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LABEL_PATH), { recursive: true });
  fs.writeFileSync(NATIVE_PATH, nativeBytes);
  fs.writeFileSync(LABEL_PATH, labelBytes);
  return {
    batches: native.length,
    captures: native.length * 13,
    native_sha256: digest(nativeBytes),
    labels_sha256: digest(labelBytes),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(generateCaptures())}\n`);
}
