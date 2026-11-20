#!/usr/bin/env node
// Freeze native holdout evidence, then score the saved Astra classifier against it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreDefense } from '../v15/defense.mjs';
import { detect } from '../v15/reference-detector.mjs';
import { buildCorpus, KINDS, SEEDS, verifyNativeProof } from './holdout-producer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultEvidenceDir = path.join(here, 'evidence');
const defaultResultsDir = path.join(here, 'results');
export const CLASSIFIER_PATH =
  '/Users/navnn/.codex/visualizations/2026/11/20/01a1f819-0353-7701-8f02-a89267d96e9f/f10-v15-astra/classifier.py';
export const CLASSIFIER_SHA256 = 'da73bed2f12a87e31bb6596504f8497b6934844a8a410341456e3543e85b3475';
export const PRODUCER_SOURCE_COMMIT = 'e0f3347b18a582c5b24679caa17b35a6d3e3a048';
const LABELS = ['cumulative-exfil', 'sanctioned-bulk', 'ambiguous', 'benign'];
const forbiddenVisibleKeys = new Set([
  '_key',
  '_delivered',
  'answer',
  'labels',
  'nonce',
  'sink',
  'value',
]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function checkVisible(value) {
  if (Array.isArray(value)) {
    value.forEach(checkVisible);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenVisibleKeys.has(key), false, `forbidden visible key: ${key}`);
      checkVisible(nested);
    }
  }
}

function safeName(file) {
  assert.equal(path.basename(file), file, `unsafe evidence path: ${file}`);
  assert.match(file, /^(?:observation|answers|proof)-410\d{2}\.json$/u);
  return file;
}

export function verifyFrozenInputs(evidenceDir, files, classifierPath = CLASSIFIER_PATH) {
  if (classifierPath !== null) {
    assert.equal(
      sha256(fs.readFileSync(classifierPath)),
      CLASSIFIER_SHA256,
      'classifier hash mismatch',
    );
  }
  for (const file of files) {
    safeName(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
    const bytes = fs.readFileSync(path.join(evidenceDir, file.path));
    const category = file.path.startsWith('observation-') ? 'observation' : 'sidecar';
    assert.equal(sha256(bytes), file.sha256, `${category} hash mismatch: ${file.path}`);
  }
}

export function makeBatch(seed, captures, answers) {
  assert.ok(SEEDS.includes(seed), 'unknown v16 seed');
  assert.equal(captures.length, KINDS.length);
  assert.equal(answers.length, KINDS.length);
  const answerById = new Map(answers.map((answer) => [answer.capture_id, answer]));
  assert.equal(answerById.size, KINDS.length, 'duplicate answer capture');
  const kinds = new Set();
  const key = new Map();
  const kindByFlow = new Map();
  for (const capture of captures) {
    checkVisible(capture);
    const answer = answerById.get(capture.capture_id);
    assert.ok(answer && answer.seed === seed, 'missing or wrong-seed answer');
    assert.ok(KINDS.includes(answer.kind) && !kinds.has(answer.kind), 'invalid or duplicate kind');
    kinds.add(answer.kind);
    assert.deepEqual(
      Object.keys(answer.labels).sort(),
      capture.flows.map((flow) => flow.flow_id).sort(),
    );
    for (const flow of capture.flows) {
      assert.equal(key.has(flow.flow_id), false, 'duplicate flow ID');
      key.set(flow.flow_id, answer.labels[flow.flow_id]);
      kindByFlow.set(flow.flow_id, answer.kind);
    }
  }
  assert.deepEqual([...kinds].sort(), [...KINDS].sort());
  const flows = captures.flatMap((capture) => capture.flows);
  const batch = { seed, captures, flows };
  Object.defineProperties(batch, {
    _key: { value: key },
    _kindByFlow: { value: kindByFlow },
  });
  return batch;
}

export function scorePrediction(batch, raw) {
  let labels;
  try {
    labels = JSON.parse(raw);
  } catch {
    labels = null;
  }
  const score = scoreDefense(batch, labels);
  const reason = score.valid
    ? null
    : labels === null || Array.isArray(labels) || typeof labels !== 'object'
      ? 'off-grammar'
      : 'label-schema';
  const pairFlowIds = batch.captures
    .filter((capture) =>
      ['covered-overlap', 'fresh-twin'].includes(batch._kindByFlow.get(capture.flows[0]?.flow_id)),
    )
    .flatMap((capture) => capture.flows.map((flow) => flow.flow_id));
  assert.equal(pairFlowIds.length, 4, 'overlap/fresh pair must have four flows');
  const pair_exact =
    score.valid && pairFlowIds.every((flowId) => labels[flowId] === batch._key.get(flowId)) ? 1 : 0;
  const mistakes_by_kind = {};
  if (score.valid) {
    for (const [flowId, truth] of batch._key) {
      if (labels[flowId] !== truth) {
        const kind = batch._kindByFlow.get(flowId);
        mistakes_by_kind[kind] = (mistakes_by_kind[kind] ?? 0) + 1;
      }
    }
  }
  return { seed: batch.seed, reason, score, pair_exact, pair_total: 1, mistakes_by_kind };
}

export function summarizeScores(results) {
  const confusion = Object.fromEntries(
    LABELS.map((truth) => [truth, Object.fromEntries(LABELS.map((prediction) => [prediction, 0]))]),
  );
  const mistakes_by_kind = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  const invalid_outputs = { off_grammar: 0, label_schema: 0 };
  for (const result of results) {
    if (result.reason) {
      invalid_outputs[result.reason === 'off-grammar' ? 'off_grammar' : 'label_schema'] += 1;
    }
    if (result.score.valid) {
      for (const truth of LABELS) {
        for (const prediction of LABELS) {
          confusion[truth][prediction] += result.score.confusion[truth][prediction];
        }
      }
    }
    for (const [kind, count] of Object.entries(result.mistakes_by_kind)) {
      mistakes_by_kind[kind] += count;
    }
  }
  return {
    completed_batches: results.length,
    exact_batches: results.filter((result) => result.score.exact).length,
    valid_batches: results.filter((result) => result.score.valid).length,
    pair_exact: results.reduce((sum, result) => sum + result.pair_exact, 0),
    pair_total: results.reduce((sum, result) => sum + result.pair_total, 0),
    confusion,
    invalid_outputs,
    mistakes_by_kind,
  };
}

function writeNew(file, value) {
  fs.writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
}

export function freezeEvidence(evidenceDir = defaultEvidenceDir) {
  assert.equal(fs.existsSync(evidenceDir), false, 'evidence directory already exists');
  const cases = buildCorpus();
  const files = [];
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const seed of SEEDS) {
    const selected = cases.filter(({ answer }) => answer.seed === seed);
    assert.deepEqual(
      selected.map(({ answer }) => answer.kind),
      KINDS,
    );
    for (const { visible, answer, proof } of selected) {
      assert.equal(verifyNativeProof(proof), true);
      assert.deepEqual(detect(visible), answer.labels);
    }
    const batch = makeBatch(
      seed,
      selected.map(({ visible }) => visible),
      selected.map(({ answer }) => answer),
    );
    const artifacts = [
      ['observation', { captures: batch.captures, flows: batch.flows }],
      ['answers', { seed, cases: selected.map(({ answer }) => answer) }],
      ['proof', { seed, cases: selected.map(({ proof }) => proof) }],
    ];
    for (const [category, value] of artifacts) {
      const name = `${category}-${seed}.json`;
      const bytes = json(value);
      writeNew(path.join(evidenceDir, name), bytes);
      files.push({ path: name, sha256: sha256(bytes) });
    }
  }
  const manifest = {
    schema_version: 'f10-v16-frozen-evidence-v1',
    source_commit: PRODUCER_SOURCE_COMMIT,
    seed_ids: SEEDS,
    capture_kinds: KINDS,
    classifier_sha256: CLASSIFIER_SHA256,
    files,
  };
  writeNew(path.join(evidenceDir, 'manifest.json'), json(manifest));
  return manifest;
}

export function loadFrozenEvidence(
  evidenceDir = defaultEvidenceDir,
  classifierPath = CLASSIFIER_PATH,
) {
  const manifestBytes = fs.readFileSync(path.join(evidenceDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema_version, 'f10-v16-frozen-evidence-v1');
  assert.equal(manifest.source_commit, PRODUCER_SOURCE_COMMIT);
  assert.equal(manifest.classifier_sha256, CLASSIFIER_SHA256);
  assert.deepEqual(manifest.seed_ids, SEEDS);
  assert.deepEqual(manifest.capture_kinds, KINDS);
  assert.deepEqual(
    manifest.files.map(({ path: file }) => file),
    SEEDS.flatMap((seed) =>
      ['observation', 'answers', 'proof'].map((category) => `${category}-${seed}.json`),
    ),
  );
  verifyFrozenInputs(evidenceDir, manifest.files, classifierPath);
  const batches = SEEDS.map((seed) => {
    const observation = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, `observation-${seed}.json`)),
    );
    const answers = JSON.parse(fs.readFileSync(path.join(evidenceDir, `answers-${seed}.json`)));
    const proofs = JSON.parse(fs.readFileSync(path.join(evidenceDir, `proof-${seed}.json`)));
    assert.deepEqual(Object.keys(observation), ['captures', 'flows']);
    assert.equal(answers.seed, seed);
    assert.equal(proofs.seed, seed);
    assert.equal(proofs.cases.length, KINDS.length);
    assert.deepEqual(
      observation.flows,
      observation.captures.flatMap((capture) => capture.flows),
    );
    const batch = makeBatch(seed, observation.captures, answers.cases);
    for (const proof of proofs.cases) {
      assert.equal(verifyNativeProof(proof), true);
      const capture = observation.captures.find((item) => item.capture_id === proof.capture_id);
      const answer = answers.cases.find((item) => item.capture_id === proof.capture_id);
      assert.ok(capture && answer, 'missing evidence capture or answer');
      assert.deepEqual(detect(capture), answer.labels);
      assert.deepEqual(proof.labels, answer.labels);
    }
    return batch;
  });
  return { manifest, manifest_sha256: sha256(manifestBytes), batches };
}

export function scoreFrozenEvidence(
  evidenceDir = defaultEvidenceDir,
  resultsDir = defaultResultsDir,
) {
  const { manifest, manifest_sha256, batches } = loadFrozenEvidence(evidenceDir);
  assert.equal(fs.existsSync(resultsDir), false, 'results directory already exists');
  fs.mkdirSync(resultsDir, { recursive: true });
  const results = [];
  for (const batch of batches) {
    const process = spawnSync(
      'python3',
      [CLASSIFIER_PATH, path.join(evidenceDir, `observation-${batch.seed}.json`)],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    if (process.error || process.status !== 0) {
      throw new Error(
        `classifier failed for seed ${batch.seed}: ${process.error?.message ?? process.stderr}`,
      );
    }
    writeNew(path.join(resultsDir, `predictions-${batch.seed}.json`), process.stdout);
    results.push(scorePrediction(batch, process.stdout));
  }
  const scored = {
    schema_version: 'f10-v16-astra-score-v1',
    source_commit: manifest.source_commit,
    evidence_manifest_sha256: manifest_sha256,
    classifier_sha256: CLASSIFIER_SHA256,
    classifier_path: CLASSIFIER_PATH,
    seed_ids: SEEDS,
    summary: summarizeScores(results),
    results,
  };
  writeNew(path.join(resultsDir, 'score.json'), json(scored));
  return scored;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === 'freeze') {
      process.stdout.write(`${JSON.stringify(freezeEvidence())}\n`);
    } else if (command === 'score') {
      process.stdout.write(`${JSON.stringify(scoreFrozenEvidence().summary)}\n`);
    } else {
      throw new Error('usage: node score-astra.mjs freeze|score');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
