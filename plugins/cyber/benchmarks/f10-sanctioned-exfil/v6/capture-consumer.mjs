// Validates immutable producer-native captures and builds evaluator-keyed defense batches.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFENSE_PROMPT, referenceDefense } from '../v3/defense.mjs';
import {
  CAPTURE_KINDS,
  CAPTURE_SEEDS,
  PAIR_CONTRACT_VERSION,
  produceCase,
  verifyNativeProof,
} from './capture-producer.mjs';

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const fileNames = ['captures-v1.json', 'answers-v1.json', 'sink-proof-v1.json'];
const forbiddenKeys = new Set([
  '_delivered',
  '_key',
  'answer',
  'coverage_verdict',
  'expected_label',
  'instance_seed',
  'labels',
  'nonce',
  'score',
  'sink',
  'terminal',
  'value',
]);

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkVisible(value) {
  if (Array.isArray(value)) {
    value.forEach(checkVisible);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden visible key: ${key}`);
      checkVisible(nested);
    }
  }
}

function leafPaths(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((item) => leafPaths(item, `${prefix}[*]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      leafPaths(nested, `${prefix}.${key}`, out);
    }
  } else {
    out.add(prefix);
  }
}

function validateLineage(lineage, captures) {
  assert.equal(lineage.schema_version, 'f10-field-lineage-v1');
  assert.equal(lineage.contract_id, 'f10-pair-v6.1-native-lineage');
  assert.equal(lineage.pair_contract_version, PAIR_CONTRACT_VERSION);
  assert.equal(lineage.normalized_schema, captures.schema_version);
  const observed = new Set();
  captures.cases.forEach((capture) => leafPaths(capture, 'captures[*]', observed));
  const declared = new Set();
  for (const group of lineage.groups) {
    assert.equal(group.kind, 'native');
    assert.ok(group.source_prefix);
    for (const field of group.fields) {
      const path = `${group.normalized_prefix}${field}`;
      assert.equal(declared.has(path), false, `duplicate lineage path: ${path}`);
      declared.add(path);
    }
  }
  for (const field of lineage.derived) {
    assert.equal(field.kind, 'derived');
    assert.ok(field.source_paths.length > 0 && field.transform_id);
    assert.equal(declared.has(field.path), false, `duplicate lineage path: ${field.path}`);
    declared.add(field.path);
  }
  assert.deepEqual(
    [...declared].sort(),
    [...observed].sort(),
    'lineage lacks an exact visible field',
  );
  assert.deepEqual(lineage.synthesized_security_fields, []);
  assert.deepEqual(lineage.evaluator_only, ['answers-v1.json', 'sink-proof-v1.json']);
}

function validateNativeCapture(capture, answer, proof) {
  assert.equal(capture.capture_id, answer.capture_id);
  assert.equal(capture.capture_id, proof.capture_id);
  assert.ok(CAPTURE_SEEDS.includes(answer.seed));
  assert.ok(CAPTURE_KINDS.includes(answer.kind));
  assert.equal(proof.spec.seed, answer.seed);
  assert.equal(proof.kind, answer.kind);
  checkVisible(capture);
  verifyNativeProof(proof);
  const reproduced = produceCase(answer.seed, answer.kind);
  assert.deepEqual(capture, reproduced.visible);
  assert.deepEqual(answer, reproduced.answer);
  assert.deepEqual(
    capture.events,
    proof.ledger.map((entry) => entry.event),
  );
  assert.deepEqual(
    capture.receipts,
    proof.ledger.map((entry) => entry.receipt),
  );
  assert.equal(capture.events.length, capture.receipts.length);
  const eventIds = new Set();
  const receiptIds = new Set();
  for (let i = 0; i < capture.events.length; i += 1) {
    const event = capture.events[i];
    const receipt = capture.receipts[i];
    assert.equal(eventIds.has(event.event_id), false, 'duplicate event ID');
    assert.equal(receiptIds.has(receipt.receipt_id), false, 'duplicate receipt ID');
    assert.equal(event.arrival_order, i);
    assert.equal(Number.isInteger(event.event_time), true);
    assert.ok(event.event_time >= 0 && event.event_time < capture.policy.horizon);
    assert.ok(event.causal_ref === null || eventIds.has(event.causal_ref));
    assert.equal(receipt.event_id, event.event_id);
    assert.equal(receipt.status, 'delivered');
    assert.equal(receipt.destination, event.destination);
    assert.equal(receipt.cell_count, event.volume.cells);
    eventIds.add(event.event_id);
    receiptIds.add(receipt.receipt_id);
  }
  assert.deepEqual(
    Object.keys(answer.labels).sort(),
    capture.flows.map((flow) => flow.flow_id).sort(),
  );
}

export function loadCorpus(evidenceDir = defaultDir) {
  const manifest = readJson(path.join(evidenceDir, 'capture-manifest.json'));
  assert.equal(manifest.schema_version, 'f10-capture-manifest-v1');
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/u);
  assert.equal(manifest.producer.task_id, 'f10-v6-offense');
  assert.equal(manifest.consumer.task_id, 'f10-v6-defense');
  assert.equal(manifest.pair_contract_version, PAIR_CONTRACT_VERSION);
  assert.equal(manifest.designation, 'estate-generated');
  assert.deepEqual(manifest.seed_range, [CAPTURE_SEEDS[0], CAPTURE_SEEDS.at(-1)]);
  assert.deepEqual(manifest.capture_kinds, CAPTURE_KINDS);
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    fileNames,
  );
  assert.equal(manifest.field_lineage.path, 'field-lineage.json');
  assert.equal(manifest.field_lineage.contract_id, 'f10-pair-v6.1-native-lineage');
  const lineageBytes = fs.readFileSync(path.join(evidenceDir, manifest.field_lineage.path));
  assert.equal(digest(lineageBytes), manifest.field_lineage.sha256);
  const lineage = JSON.parse(lineageBytes);
  const values = manifest.files.map((entry) => {
    assert.equal(path.basename(entry.path), entry.path, 'unsafe fixture path');
    const bytes = fs.readFileSync(path.join(evidenceDir, entry.path));
    assert.equal(digest(bytes), entry.sha256, `fixture hash mismatch: ${entry.path}`);
    return JSON.parse(bytes);
  });
  const [captures, answers, proofs] = values;
  assert.equal(captures.schema_version, 'f10-native-capture-v1');
  assert.equal(answers.schema_version, 'f10-evaluator-answers-v1');
  assert.equal(proofs.schema_version, 'f10-native-sink-proof-v1');
  validateLineage(lineage, captures);
  const expectedCount = CAPTURE_SEEDS.length * CAPTURE_KINDS.length;
  assert.equal(captures.cases.length, expectedCount);
  assert.equal(answers.cases.length, expectedCount);
  assert.equal(proofs.cases.length, expectedCount);
  const answersById = new Map(answers.cases.map((answer) => [answer.capture_id, answer]));
  const proofsById = new Map(proofs.cases.map((proof) => [proof.capture_id, proof]));
  assert.equal(answersById.size, expectedCount);
  assert.equal(proofsById.size, expectedCount);
  const captureIds = new Set();
  for (const capture of captures.cases) {
    assert.equal(captureIds.has(capture.capture_id), false, 'duplicate capture ID');
    captureIds.add(capture.capture_id);
    const answer = answersById.get(capture.capture_id);
    const proof = proofsById.get(capture.capture_id);
    assert.ok(answer && proof, `missing producer sidecar: ${capture.capture_id}`);
    validateNativeCapture(capture, answer, proof);
  }
  return { manifest, captures, answers, proofs, lineage };
}

export function loadBatch(seed, evidenceDir = defaultDir) {
  if (!CAPTURE_SEEDS.includes(seed)) {
    throw new Error('unknown vendored F10 defense seed');
  }
  const corpus = loadCorpus(evidenceDir);
  const answersById = new Map(corpus.answers.cases.map((answer) => [answer.capture_id, answer]));
  const captures = corpus.captures.cases.filter(
    (capture) => answersById.get(capture.capture_id)?.seed === seed,
  );
  assert.equal(captures.length, CAPTURE_KINDS.length);
  const flows = captures.flatMap((capture) => capture.flows);
  const key = new Map();
  for (const capture of captures) {
    const answer = answersById.get(capture.capture_id);
    for (const [flowId, label] of Object.entries(answer.labels)) {
      assert.equal(key.has(flowId), false, 'duplicate flow ID');
      key.set(flowId, label);
    }
  }
  assert.equal(key.size, flows.length);
  const batch = { seed, prompt: DEFENSE_PROMPT, captures, flows };
  Object.defineProperty(batch, '_key', { value: key });
  assert.deepEqual(referenceDefense(batch), Object.fromEntries(key));
  return batch;
}
