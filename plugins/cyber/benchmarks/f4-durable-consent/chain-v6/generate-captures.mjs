#!/usr/bin/env node
// Deterministic native F4 v6 candidate captures; no model calls.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels } from '../chain-v4/capture.mjs';
import { SYSTEM_PROMPT } from '../chain-v5/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { produceNativeBatchV6 } from './producer.mjs';

export const SEEDS = Object.freeze([14021, 14022, 14023, 14024, 14025, 14026, 14027, 14028, 14029]);
const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.dirname(here);
export const NATIVE_PATH = path.join(here, 'capture', 'native-v6.jsonl');
export const LABEL_PATH = path.join(here, 'evaluator', 'labels-v6.jsonl');
export const MANIFEST_PATH = path.join(here, 'manifest.json');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const SOURCE_PATHS = Object.freeze([
  'chain-cloudflare-v1/screen.mjs',
  'chain-cloudflare-v2/transport-preload.mjs',
  'chain-cloudflare-v3/pace.mjs',
  'chain-v3/offense.mjs',
  'chain-v3/runner.mjs',
  'chain-v4/capture.mjs',
  'chain-v4/producer.mjs',
  'chain-v4/runner.mjs',
  'chain-v5/runner.mjs',
  'chain-v6/generate-captures.mjs',
  'chain-v6/producer.mjs',
  'chain-v6/screen.mjs',
  'shared/estate.mjs',
]);

export function generateCaptures() {
  const native = [];
  const labels = [];
  for (const seed of SEEDS) {
    for (const family of FAMILIES) {
      const batch = produceNativeBatchV6({ seed, family });
      const key = evaluatorLabels(batch);
      if (JSON.stringify(referenceLabels(batch)) !== JSON.stringify(key)) {
        throw new Error(`v6 candidate key mismatch: ${seed}/${family}`);
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
  const sourceHashes = Object.fromEntries(
    SOURCE_PATHS.map((name) => [name, sha(fs.readFileSync(path.join(parent, name)))]),
  );
  const manifest = {
    candidate_id: 'f4-defense-native-v6-glm53',
    source_base_commit: 'fe5940cdc',
    seeds: SEEDS,
    families: FAMILIES,
    order: 'seed-then-family',
    batches: native.length,
    records: native.length * 13,
    capture_sha256: sha(nativeBytes),
    labels_sha256: sha(labelBytes),
    prompt_sha256: sha(SYSTEM_PROMPT),
    source_sha256: sourceHashes,
    model: '@cf/zai-org/glm-5.3',
    max_tokens: 16384,
    reasoning_effort: 'low',
    minimum_request_start_gap_ms: 5000,
    status: 'offline-candidate-no-model-calls',
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    batches: manifest.batches,
    records: manifest.records,
    native_sha256: manifest.capture_sha256,
    labels_sha256: manifest.labels_sha256,
    manifest,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(generateCaptures())}\n`);
}
