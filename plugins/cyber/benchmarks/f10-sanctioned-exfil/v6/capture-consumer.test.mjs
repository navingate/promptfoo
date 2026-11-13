import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { referenceDefense, scoreDefense } from '../v3/defense.mjs';
import { loadBatch, loadCorpus } from './capture-consumer.mjs';

const sourceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function changedFixture(fileName, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v6-consumer-'));
  for (const name of [
    'capture-manifest.json',
    'captures-v1.json',
    'answers-v1.json',
    'sink-proof-v1.json',
    'field-lineage.json',
  ]) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(dir, name));
  }
  const file = path.join(dir, fileName);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(value);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, bytes);
  const manifestFile = path.join(dir, 'capture-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (fileName === 'field-lineage.json') {
    manifest.field_lineage.sha256 = digest(bytes);
  } else {
    manifest.files.find((entry) => entry.path === fileName).sha256 = digest(bytes);
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

test('consumer scores exactly the hashed producer captures with evaluator-only keys', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.captures.cases.length, 60);
  assert.equal(corpus.answers.cases.length, 60);
  assert.equal(corpus.proofs.cases.length, 60);
  assert.equal(corpus.lineage.contract_id, 'f10-pair-v6.1-native-lineage');
  for (let seed = 12001; seed <= 12012; seed += 1) {
    const batch = loadBatch(seed);
    assert.equal(batch.captures.length, 5);
    assert.equal(scoreDefense(batch, referenceDefense(batch)).exact, true, `seed ${seed}`);
    const staged = JSON.stringify(batch);
    for (const forbidden of ['"labels"', '"_key"', '"nonce"', '"sink"', '"value"', '"terminal"']) {
      assert.equal(staged.includes(forbidden), false, `${seed}: leaked ${forbidden}`);
    }
  }
});

test('consumer rejects a security-relevant synthesized lineage field', () => {
  const dir = changedFixture('field-lineage.json', (value) => {
    value.derived[0].kind = 'synthesized';
    value.derived[0].security_relevant = true;
  });
  try {
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('consumer rejects a forged native receipt even when its file hash is updated', () => {
  const dir = changedFixture('captures-v1.json', (value) => {
    value.cases.find((capture) => capture.receipts.length > 0).receipts[0].event_id = 'evt-forged';
  });
  try {
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('consumer rejects a modified delivered sink value even when its hash is updated', () => {
  const dir = changedFixture('sink-proof-v1.json', (value) => {
    value.cases.find((proof) => proof.sink.length > 0).sink[0].cells[0].value = 'forged';
  });
  try {
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('consumer rejects an answer-shaped field in model-visible capture', () => {
  const dir = changedFixture('captures-v1.json', (value) => {
    value.cases[0].expected_label = 'cumulative-exfil';
  });
  try {
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('consumer rejects changed job authority and evaluator truth independently', () => {
  for (const [file, mutate] of [
    [
      'captures-v1.json',
      (value) => {
        value.cases.find((capture) =>
          capture.events.some((event) => event.job_ref),
        ).job_registry[0].actor_binding = ['forged'];
      },
    ],
    [
      'answers-v1.json',
      (value) => {
        const answer = value.cases.find((item) => Object.keys(item.labels).length > 0);
        answer.labels[Object.keys(answer.labels)[0]] = 'benign';
      },
    ],
  ]) {
    const dir = changedFixture(file, mutate);
    try {
      assert.throws(() => loadCorpus(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
