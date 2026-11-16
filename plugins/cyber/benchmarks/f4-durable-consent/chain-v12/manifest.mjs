#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectBatch } from '../chain-v9/project.mjs';
import { makeProjectedControls } from '../chain-v10/controls.mjs';
import { INSTANCE_CONFIGS } from './freeze.mjs';
import { modelMessages, REQUEST_SETTINGS, serializeRequestBody } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.dirname(here);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readDefault = (relative) => fs.readFileSync(path.join(parent, relative));
const instanceFields = [
  'batches',
  'records',
  'native_sha256',
  'labels_sha256',
  'development_sha256',
  'messages_sha256',
  'request_body_sha256',
];

// Security-path files are deliberately enumerated; the manifest may not add or omit a binding.
export const SOURCES = Object.freeze([
  'chain-v3/offense.mjs',
  'chain-v4/capture.mjs',
  'chain-v4/producer.mjs',
  'chain-v9/project.mjs',
  'chain-v9/prompt.mjs',
  'chain-v9/reference.sql',
  'chain-v9/sql_child.py',
  'chain-v9/sql-executor.mjs',
  'chain-v10/cohort.mjs',
  'chain-v10/producer.mjs',
  'chain-v10/controls.mjs',
  'chain-v10/screen.mjs',
  'chain-v10/generate-captures.mjs',
  'chain-v10/manifest.json',
  'chain-v10/capture/native-v10.jsonl',
  'chain-v12/freeze.mjs',
  'chain-v12/prompt.mjs',
  'chain-v12/screen.mjs',
  'chain-v12/manifest.mjs',
  'defense/scripts/harness.mjs',
  'shared/estate.mjs',
]);

const SETTINGS = Object.freeze({
  candidate_id: 'f4-detection-rule-v12-offline',
  status: 'offline-candidate-no-model-calls',
  contract: 'f4-consent-native-v4',
  model: REQUEST_SETTINGS.model,
  endpoint_id: 'cloudflare-openai-compatible',
  max_tokens: REQUEST_SETTINGS.max_tokens,
  reasoning_effort: REQUEST_SETTINGS.reasoning_effort,
  temperature: REQUEST_SETTINGS.temperature,
  stream: REQUEST_SETTINGS.stream,
  cache_policy: 'cf-aig-skip-cache:true',
  request_gap_ms: 5000,
  planned_model_calls: 3,
  retry_policy: 'none',
});

function exactKeys(actual, expected, description) {
  if (
    !actual ||
    typeof actual !== 'object' ||
    Array.isArray(actual) ||
    JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify([...expected].sort())
  ) {
    throw new Error(`${description} binding mismatch`);
  }
}

function assertHash(actual, expected, description) {
  if (
    typeof expected !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(expected) ||
    sha256(actual) !== expected
  ) {
    throw new Error(`${description} binding mismatch`);
  }
}

function requestBytes(instance) {
  const messages = modelMessages(instance);
  const messagesJson = JSON.stringify(messages);
  const requestBodyJson = serializeRequestBody(messages);
  return { messagesJson, requestBodyJson };
}

function filesFor(instance, readBytes) {
  const base = `chain-v12/instances/${instance}`;
  return {
    native: readBytes(`${base}/native.jsonl`),
    labels: readBytes(`${base}/labels.jsonl`),
    development: readBytes(`${base}/development.json`),
  };
}

export function generateManifest({ readBytes = readDefault } = {}) {
  const instances = {};
  for (const instance of Object.keys(INSTANCE_CONFIGS)) {
    const files = filesFor(instance, readBytes);
    const { messagesJson, requestBodyJson } = requestBytes(instance);
    instances[instance] = {
      batches: 36,
      records: 468,
      native_sha256: sha256(files.native),
      labels_sha256: sha256(files.labels),
      development_sha256: sha256(files.development),
      messages_sha256: sha256(messagesJson),
      request_body_sha256: sha256(requestBodyJson),
    };
  }
  return {
    ...SETTINGS,
    instances,
    source_sha256: Object.fromEntries(
      SOURCES.map((relative) => [relative, sha256(readBytes(relative))]),
    ),
  };
}

export function verifyManifest(manifest, { readBytes = readDefault } = {}) {
  for (const [field, expected] of Object.entries(SETTINGS)) {
    if (manifest?.[field] !== expected) {
      throw new Error(`${field} setting mismatch`);
    }
  }
  exactKeys(manifest.source_sha256, SOURCES, 'source');
  for (const relative of SOURCES) {
    assertHash(readBytes(relative), manifest.source_sha256[relative], `source ${relative}`);
  }
  exactKeys(manifest.instances, Object.keys(INSTANCE_CONFIGS), 'instance');
  const verified = {};
  for (const instance of Object.keys(INSTANCE_CONFIGS)) {
    const binding = manifest.instances[instance];
    exactKeys(binding, instanceFields, `${instance} instance`);
    if (binding.batches !== 36 || binding.records !== 468) {
      throw new Error(`${instance} corpus grid binding mismatch`);
    }
    const files = filesFor(instance, readBytes);
    assertHash(files.native, binding.native_sha256, `${instance} native`);
    assertHash(files.labels, binding.labels_sha256, `${instance} labels`);
    assertHash(files.development, binding.development_sha256, `${instance} development`);
    const { messagesJson, requestBodyJson } = requestBytes(instance);
    assertHash(messagesJson, binding.messages_sha256, `${instance} messages`);
    assertHash(requestBodyJson, binding.request_body_sha256, `${instance} request body`);
    const batches = files.native.toString('utf8').trim().split('\n').map(JSON.parse);
    const keys = files.labels.toString('utf8').trim().split('\n').map(JSON.parse);
    if (
      batches.length !== 36 ||
      keys.length !== 36 ||
      batches.some(
        (batch, index) =>
          batch.seed !== keys[index].seed ||
          batch.family !== keys[index].family ||
          batch.captures?.length !== 13,
      )
    ) {
      throw new Error(`${instance} corpus grid binding mismatch`);
    }
    const controls = makeProjectedControls(batches);
    if (controls.length !== 16) {
      throw new Error(`${instance} projected-control grid binding mismatch`);
    }
    verified[instance] = {
      batches,
      keys,
      projected: batches.map(projectBatch),
      controls,
      messagesJson,
      requestBodyJson,
      requestBodySha256: sha256(requestBodyJson),
    };
  }
  return verified;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    throw new Error('use --write to regenerate the v12 manifest');
  }
  fs.writeFileSync(
    path.join(here, 'manifest.json'),
    `${JSON.stringify(generateManifest(), null, 2)}\n`,
  );
}
