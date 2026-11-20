import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { produceCase } from './holdout-producer.mjs';
import {
  CLASSIFIER_SHA256,
  makeBatch,
  scorePrediction,
  summarizeScores,
  verifyFrozenInputs,
} from './score-astra.mjs';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
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
