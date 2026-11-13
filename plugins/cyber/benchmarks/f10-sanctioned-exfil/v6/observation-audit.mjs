#!/usr/bin/env node
// Exact model-context inventory for the vendored F10 v6 defensive twin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFENSE_PROMPT } from '../v3/defense.mjs';
import { loadBatch, loadCorpus, serializeObservation } from './capture-consumer.mjs';
import { CAPTURE_SEEDS, PAIR_CONTRACT_VERSION } from './capture-producer.mjs';

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function buildObservationManifest(consumerSourceCommit) {
  if (!/^[0-9a-f]{40}$/u.test(consumerSourceCommit)) {
    throw new Error('consumer source commit must be a full Git SHA');
  }
  const corpus = loadCorpus();
  const instances = CAPTURE_SEEDS.map((seed) => {
    const batch = loadBatch(seed);
    return {
      seed,
      capture_ids: batch.captures.map((capture) => capture.capture_id),
      flow_count: batch.flows.length,
      user_message_sha256: hash(serializeObservation(batch)),
    };
  });
  return {
    schema_version: 'f10-observation-manifest-v1',
    pair_contract_version: PAIR_CONTRACT_VERSION,
    producer_source_commit: corpus.manifest.source_commit,
    consumer_source_commit: consumerSourceCommit,
    capture_manifest_sha256: hash(fs.readFileSync(path.join(evidenceDir, 'capture-manifest.json'))),
    system_prompt_sha256: hash(DEFENSE_PROMPT),
    field_lineage_sha256: corpus.manifest.field_lineage.sha256,
    categories: {
      prompts: [{ name: 'defense-system', sha256: hash(DEFENSE_PROMPT) }],
      files: [{ path: 'evidence/captures-v1.json', sha256: corpus.manifest.files[0].sha256 }],
      telemetry: [
        'policy',
        'catalog',
        'job_registry',
        'native_completed_events',
        'native_sink_receipts',
        'derived_flow_ids',
      ],
      tool_descriptions: [],
      feedback: [],
      exposed_environment: [],
      artifacts: [],
      serialized_results: [],
    },
    forbidden_evaluator_keys: [
      'labels',
      '_key',
      'nonce',
      'sink',
      'score',
      'terminal',
      'value',
      '_delivered',
    ],
    instances,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, sourceCommit] = process.argv.slice(2);
  if (flag !== '--source-commit') {
    throw new Error('usage: node observation-audit.mjs --source-commit <full-sha>');
  }
  const manifest = buildObservationManifest(sourceCommit);
  const file = path.join(evidenceDir, 'observation-manifest.json');
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${file}\n`);
}
