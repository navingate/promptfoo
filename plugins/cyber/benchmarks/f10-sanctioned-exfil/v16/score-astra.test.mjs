import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { produceCase } from './holdout-producer.mjs';
import {
  CLASSIFIER_PATH,
  CLASSIFIER_SHA256,
  loadFrozenEvidence,
  makeBatch,
  parseArgs,
  scoreFrozenEvidence,
  scorePrediction,
  summarizeScores,
  verifyFrozenInputs,
} from './score-astra.mjs';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const frozenEvidence = path.join(import.meta.dirname, 'evidence');
const withEvidenceCopy = (run) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v16-evidence-test-'));
  const copy = path.join(directory, 'evidence');
  try {
    fs.cpSync(frozenEvidence, copy, { recursive: true });
    run(copy);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
const rewriteWithHash = (directory, name, value) => {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.files.find((entry) => entry.path === name).sha256 = hash(fs.readFileSync(file));
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
};
const cases = ['covered-overlap', 'fresh-twin', 'dangling-citation', 'bound-control'].map((kind) =>
  produceCase(41001, kind, {
    nonce: `score-test-${kind}`,
    captureNonce: `score-capture-${kind}`,
  }),
);

test('v16 batch keeps truth private and scores exact labels through v15 scorer', () => {
  const batch = makeBatch(
    41001,
    cases.map(({ visible }) => visible),
    cases.map(({ answer }) => answer),
  );
  assert.deepEqual(Object.keys(batch), ['seed', 'captures', 'flows']);
  assert.equal(Object.hasOwn(batch, '_key'), true);
  assert.equal(JSON.stringify(batch).includes('"_key"'), false);
  const exact = scorePrediction(batch, JSON.stringify(Object.fromEntries(batch._key)));
  assert.equal(exact.score.valid, true);
  assert.equal(exact.score.exact, true);
  assert.equal(exact.pair_exact, 1);
  assert.equal(exact.pair_total, 1);
  assert.deepEqual(exact.mistakes_by_kind, {});
});

test('wrong twin decoy label breaks four-flow pair and enters aggregate confusion', () => {
  const batch = makeBatch(
    41001,
    cases.map(({ visible }) => visible),
    cases.map(({ answer }) => answer),
  );
  const wrong = Object.fromEntries(batch._key);
  const decoyId = cases[1].visible.flows[1].flow_id;
  wrong[decoyId] = 'sanctioned-bulk';
  const scored = scorePrediction(batch, JSON.stringify(wrong));
  const summary = summarizeScores([scored]);
  assert.equal(scored.score.valid, true);
  assert.equal(scored.score.exact, false);
  assert.equal(scored.pair_exact, 0);
  assert.equal(scored.mistakes_by_kind['fresh-twin'], 1);
  assert.equal(summary.exact_batches, 0);
  assert.equal(summary.pair_exact, 0);
  assert.equal(summary.confusion.benign['sanctioned-bulk'], 1);
  assert.equal(summary.confusion['sanctioned-bulk']['sanctioned-bulk'], 4);
  assert.equal(summary.confusion.ambiguous.ambiguous, 1);
});

test('raw output must be one JSON mapping with exact flow keys and allowed labels', () => {
  const batch = makeBatch(
    41001,
    cases.map(({ visible }) => visible),
    cases.map(({ answer }) => answer),
  );
  const exact = Object.fromEntries(batch._key);
  for (const raw of ['not json', `\`\`\`json\n${JSON.stringify(exact)}\n\`\`\``, '[]']) {
    const result = scorePrediction(batch, raw);
    assert.equal(result.reason, 'off-grammar');
    assert.equal(result.score.valid, false);
    assert.equal(result.pair_exact, 0);
  }
  for (const invalid of [
    { ...exact, extra: 'benign' },
    { ...exact, [batch.flows[0].flow_id]: 'unknown' },
  ]) {
    const result = scorePrediction(batch, JSON.stringify(invalid));
    assert.equal(result.reason, 'label-schema');
    assert.equal(result.score.valid, false);
  }
  assert.equal(
    summarizeScores([scorePrediction(batch, 'not json')]).invalid_outputs.off_grammar,
    1,
  );
});

test('frozen input check refuses changed classifier and observation bytes before scoring', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v16-score-test-'));
  try {
    const classifier = path.join(directory, 'classifier.py');
    const observation = path.join(directory, 'observation-41001.json');
    fs.writeFileSync(classifier, 'frozen fixture');
    fs.writeFileSync(observation, '{"captures":[],"flows":[]}');
    const files = [{ path: 'observation-41001.json', sha256: hash(fs.readFileSync(observation)) }];
    assert.throws(() => verifyFrozenInputs(directory, files, classifier), /classifier.*hash/i);
    assert.notEqual(hash(fs.readFileSync(classifier)), CLASSIFIER_SHA256);
    assert.throws(
      () => verifyFrozenInputs(directory, [{ ...files[0], sha256: '0'.repeat(64) }], null),
      /observation.*hash/i,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('matching manifest hashes cannot hide a capture policy change from its native proof', () => {
  withEvidenceCopy((directory) => {
    const name = 'observation-41001.json';
    const observation = JSON.parse(fs.readFileSync(path.join(directory, name)));
    observation.captures[0].policy.cumulative_aggregate_limit += 1;
    rewriteWithHash(directory, name, observation);
    assert.throws(() => loadFrozenEvidence(directory, null), /visible|capture|proof/i);
  });
});

test('four duplicate valid proofs cannot stand in for four distinct observed captures', () => {
  withEvidenceCopy((directory) => {
    const name = 'proof-41001.json';
    const proofs = JSON.parse(fs.readFileSync(path.join(directory, name)));
    proofs.cases = Array.from({ length: 4 }, () => proofs.cases[0]);
    rewriteWithHash(directory, name, proofs);
    assert.throws(() => loadFrozenEvidence(directory, null), /duplicate|proof|capture/i);
  });
});

test('default classifier is a vendored exact-byte copy with the frozen hash', () => {
  assert.equal(CLASSIFIER_PATH, path.join(import.meta.dirname, 'classifier.py'));
  assert.equal(hash(fs.readFileSync(CLASSIFIER_PATH)), CLASSIFIER_SHA256);
  const manifest = JSON.parse(fs.readFileSync(path.join(frozenEvidence, 'manifest.json')));
  assert.doesNotThrow(() => verifyFrozenInputs(frozenEvidence, manifest.files));
});

test('score CLI accepts a fresh output directory and rejects malformed options', () => {
  const output = path.join(os.tmpdir(), 'f10-v16-new-results');
  assert.deepEqual(parseArgs(['score', '--output-dir', output]), {
    command: 'score',
    outputDir: output,
  });
  assert.deepEqual(parseArgs(['freeze']), { command: 'freeze', outputDir: null });
  assert.throws(() => parseArgs(['score', '--output-dir']), /output-dir|missing/i);
  assert.throws(() => parseArgs(['score', '--unknown']), /unknown|usage/i);
  assert.throws(() => parseArgs(['freeze', '--output-dir', output]), /output-dir|usage/i);
  assert.throws(
    () => scoreFrozenEvidence(frozenEvidence, path.join(import.meta.dirname, 'results')),
    /results directory already exists/i,
  );
});
