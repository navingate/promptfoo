#!/usr/bin/env node
// Fresh, reference-produced F4 defense captures; v4 estate and scorer unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels } from '../chain-v4/capture.mjs';
import { produceNativeBatch } from '../chain-v4/producer.mjs';
import { FAMILIES } from '../shared/estate.mjs';

export const SEEDS = Object.freeze([12021, 12022, 12023, 12024, 12025, 12026, 12027, 12028, 12029]);
const here = path.dirname(fileURLToPath(import.meta.url));
export const NATIVE_PATH = path.join(here, 'capture', 'native-v5.jsonl');
export const LABEL_PATH = path.join(here, 'evaluator', 'labels-v5.jsonl');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function generateCaptures() {
  const native = [];
  const labels = [];
  for (const seed of SEEDS) {
    for (const family of FAMILIES) {
      const batch = produceNativeBatch({ seed, family });
      const key = evaluatorLabels(batch);
      if (JSON.stringify(referenceLabels(batch)) !== JSON.stringify(key)) {
        throw new Error(`capture key mismatch: ${seed}/${family}`);
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
    records: native.length * 13,
    native_sha256: sha(nativeBytes),
    labels_sha256: sha(labelBytes),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(generateCaptures())}\n`);
}
