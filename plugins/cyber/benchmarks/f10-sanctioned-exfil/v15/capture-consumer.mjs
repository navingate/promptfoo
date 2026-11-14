// Validates immutable producer-native captures and builds evaluator-keyed defense batches.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPTURE_KINDS,
  CAPTURE_SEEDS,
  PAIR_CONTRACT_VERSION,
  produceCase,
  verifyNativeProof,
} from './capture-producer.mjs';
import { DEFENSE_PROMPT, referenceDefense } from './defense.mjs';

// Source contract: evidence manifests may repeat this hash, but cannot redefine it.
const FIELD_LINEAGE_SHA256 = '1139e8efa944b978ad050d4a1799f69c58bc396cb3ce2230ae921ef2253dab04';

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const fileNames = ['captures-v1.json', 'answers-v1.json', 'sink-proof-v1.json'];
const forbiddenKeys = new Set([
  '_delivered',
  '_key',
  'answer',
  'coverage_verdict',
  'covered',
  'uncovered',
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
  assert.equal(lineage.contract_id, 'f10-pair-v15.1-native-lineage');
  assert.equal(lineage.pair_contract_version, PAIR_CONTRACT_VERSION);
  assert.equal(lineage.normalized_schema, captures.schema_version);
  const observed = new Set();
  captures.cases.forEach((capture) => leafPaths(capture, 'captures[*]', observed));
  captures.cases
    .flatMap((capture) => capture.flows)
    .forEach((flow) => leafPaths(flow, 'flows[*]', observed));
  const declared = new Set();
  for (const group of lineage.groups) {
    assert.equal(group.kind, 'native');
    assert.ok(group.source_prefix);
    if (group.normalized_prefix === 'captures[*].receipts[*].') {
      assert.equal(group.label_input, true, 'receipt lineage must be a label input');
    }
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
  assert.equal(proof.captureNonce.length > 0, true);
  assert.equal(proof.kind, answer.kind);
  checkVisible(capture);
  verifyNativeProof(proof);
  const reproduced = produceCase(answer.seed, answer.kind, {
    nonce: proof.spec.nonce,
    captureNonce: proof.captureNonce,
  });
  assert.deepEqual(capture, reproduced.visible);
  assert.deepEqual(answer, reproduced.answer);
  assert.deepEqual(proof, reproduced.proof);
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
  const stagesById = new Map(capture.stages.map((stage) => [stage.stage_ref, stage]));
  const profilesById = new Map(
    capture.publisher_profiles.map((profile) => [profile.profile_id, profile]),
  );
  assert.equal(stagesById.size, capture.stages.length);
  assert.equal(profilesById.size, capture.publisher_profiles.length);
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
    const stage = stagesById.get(receipt.stage_ref);
    const profile = profilesById.get(receipt.profile_id);
    assert.ok(stage && profile, 'delivered receipt lacks native stage/profile');
    assert.equal(receipt.report_ref, stage.report_ref);
    assert.equal(receipt.report_owner, stage.report_owner);
    assert.equal(receipt.publisher_actor, profile.actor_binding);
    assert.equal(stage.report_owner, profile.actor_binding);
    assert.equal(event.actor.identity, stage.report_owner);
    assert.equal(stage.destination, event.destination);
    assert.equal(profile.destination, event.destination);
    assert.equal(stage.event_time, event.event_time);
    eventIds.add(event.event_id);
    receiptIds.add(receipt.receipt_id);
  }
  for (const attempt of capture.blocked_publish_attempts) {
    const profile = profilesById.get(attempt.profile_id);
    assert.ok(profile);
    assert.equal(attempt.reason, 'publisher-owner-mismatch');
    assert.equal(attempt.staged_refs.length, 1);
    const stage = stagesById.get(attempt.staged_refs[0]);
    assert.ok(stage);
    assert.notEqual(profile.actor_binding, stage.report_owner);
    assert.equal(capture.events.length, 0, 'blocked publication cannot create a flow');
  }
  assert.equal(
    capture.stages.length,
    capture.receipts.length + capture.blocked_publish_attempts.length,
    'each native stage must be delivered or explicitly blocked',
  );
  assert.deepEqual(
    Object.keys(answer.labels).sort(),
    capture.flows.map((flow) => flow.flow_id).sort(),
  );
}

export function loadCorpus(evidenceDir = defaultDir) {
  const manifest = readJson(path.join(evidenceDir, 'capture-manifest.json'));
  assert.equal(manifest.schema_version, 'f10-capture-manifest-v1');
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/u);
  assert.equal(manifest.producer.task_id, 'f10-v15-capture');
  assert.equal(manifest.consumer.task_id, 'f10-v15-defense');
  assert.equal(manifest.pair_contract_version, PAIR_CONTRACT_VERSION);
  assert.equal(manifest.designation, 'estate-generated');
  assert.deepEqual(manifest.seed_range, [CAPTURE_SEEDS[0], CAPTURE_SEEDS.at(-1)]);
  assert.deepEqual(manifest.seed_ids, CAPTURE_SEEDS);
  assert.deepEqual(manifest.capture_kinds, CAPTURE_KINDS);
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    fileNames,
  );
  assert.equal(manifest.field_lineage.path, 'field-lineage.json');
  assert.equal(manifest.field_lineage.contract_id, 'f10-pair-v15.1-native-lineage');
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
  assert.equal(digest(lineageBytes), FIELD_LINEAGE_SHA256, 'lineage contract hash mismatch');
  const expectedCount = CAPTURE_SEEDS.length * CAPTURE_KINDS.length;
  assert.equal(captures.cases.length, expectedCount);
  assert.equal(answers.cases.length, expectedCount);
  assert.equal(proofs.cases.length, expectedCount);
  const answersById = new Map(answers.cases.map((answer) => [answer.capture_id, answer]));
  const proofsById = new Map(proofs.cases.map((proof) => [proof.capture_id, proof]));
  assert.equal(answersById.size, expectedCount);
  assert.equal(proofsById.size, expectedCount);
  const captureIds = new Set();
  const captureNonces = new Set();
  for (const capture of captures.cases) {
    assert.equal(captureIds.has(capture.capture_id), false, 'duplicate capture ID');
    captureIds.add(capture.capture_id);
    const answer = answersById.get(capture.capture_id);
    const proof = proofsById.get(capture.capture_id);
    assert.ok(answer && proof, `missing producer sidecar: ${capture.capture_id}`);
    assert.equal(captureNonces.has(proof.captureNonce), false, 'reused private capture nonce');
    captureNonces.add(proof.captureNonce);
    validateNativeCapture(capture, answer, proof);
  }
  for (const seed of CAPTURE_SEEDS) {
    const byKind = new Map(
      proofs.cases.filter((proof) => proof.spec.seed === seed).map((proof) => [proof.kind, proof]),
    );
    for (const [fresh, duplicate] of [
      ['alternate-over', 'alternate-boundary'],
      ['mixed-cap-cross', 'mixed-cap-safe'],
    ]) {
      assert.equal(
        byKind.get(fresh)?.spec.nonce,
        byKind.get(duplicate)?.spec.nonce,
        'paired cases must share native session nonce',
      );
      assert.notEqual(byKind.get(fresh)?.captureNonce, byKind.get(duplicate)?.captureNonce);
    }
  }
  return { manifest, captures, answers, proofs, lineage };
}

function batchFromCorpus(seed, corpus) {
  if (!CAPTURE_SEEDS.slice(0, 12).includes(seed)) {
    throw new Error('unknown vendored F10 defense seed');
  }
  const answersById = new Map(corpus.answers.cases.map((answer) => [answer.capture_id, answer]));
  const captures = corpus.captures.cases
    .filter((capture) => answersById.get(capture.capture_id)?.seed === seed)
    .sort((a, b) =>
      digest(`f10-v15|display|${seed}|${a.capture_id}`).localeCompare(
        digest(`f10-v15|display|${seed}|${b.capture_id}`),
      ),
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
  const pairedKinds = ['alternate-over', 'alternate-boundary', 'mixed-cap-cross', 'mixed-cap-safe'];
  const pairFlowIds = new Map(
    pairedKinds.map((kind) => {
      const capture = captures.find((item) => answersById.get(item.capture_id)?.kind === kind);
      assert.ok(capture, `missing paired capture: ${kind}`);
      assert.equal(capture.flows.length, 2);
      return [kind, capture.flows.map((flow) => flow.flow_id)];
    }),
  );
  Object.defineProperty(batch, '_pairFlowIds', { value: pairFlowIds });
  assert.deepEqual(referenceDefense(batch), Object.fromEntries(key));
  return batch;
}

export function loadBatch(seed, evidenceDir = defaultDir) {
  return batchFromCorpus(seed, loadCorpus(evidenceDir));
}

export function loadScoredBatches(evidenceDir = defaultDir) {
  const corpus = loadCorpus(evidenceDir);
  return CAPTURE_SEEDS.slice(0, 12).map((seed) => batchFromCorpus(seed, corpus));
}

export function serializeObservation(batch) {
  const observation = { captures: batch.captures, flows: batch.flows };
  checkVisible(observation);
  return JSON.stringify(observation);
}
