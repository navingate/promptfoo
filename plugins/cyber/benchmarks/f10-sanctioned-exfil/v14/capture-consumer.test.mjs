import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch, loadCorpus, serializeObservation } from './capture-consumer.mjs';
import { buildCorpus, writeCorpus } from './capture-producer.mjs';
import { buildObservationManifest } from './observation-audit.mjs';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v14-consumer-'));
fs.copyFileSync(
  path.join(here, 'evidence/field-lineage.json'),
  path.join(dir, 'field-lineage.json'),
);
writeCorpus(source, dir);

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function rewrite(name, mutate) {
  const file = path.join(dir, name);
  const original = fs.readFileSync(file);
  const manifestFile = path.join(dir, 'capture-manifest.json');
  const originalManifest = fs.readFileSync(manifestFile);
  try {
    const value = JSON.parse(original);
    mutate(value);
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(file, bytes);
    const manifest = JSON.parse(originalManifest);
    manifest.files.find((entry) => entry.path === name).sha256 = hash(bytes);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.writeFileSync(file, original);
    fs.writeFileSync(manifestFile, originalManifest);
  }
}

test('corpus has private paired capture IDs and shared native session nonce', () => {
  const corpus = buildCorpus([14001]);
  const byKind = new Map(corpus.proof.cases.map((proof) => [proof.kind, proof]));
  for (const [fresh, duplicate] of [
    ['alternate-over', 'alternate-boundary'],
    ['mixed-cap-cross', 'mixed-cap-safe'],
  ]) {
    assert.notEqual(byKind.get(fresh).captureNonce, byKind.get(duplicate).captureNonce);
    assert.equal(byKind.get(fresh).spec.nonce, byKind.get(duplicate).spec.nonce);
    assert.deepEqual(
      byKind.get(fresh).ledger.slice(0, -1),
      byKind.get(duplicate).ledger.slice(0, -1),
    );
  }
});

test('consumer validates provisional corpus and scored batch boundary', () => {
  const corpus = loadCorpus(dir);
  assert.equal(corpus.captures.cases.length, 140);
  const batch = loadBatch(14001, dir);
  assert.equal(batch.flows.length, 12);
  assert.equal(batch._key.size, 12);
  assert.throws(() => loadBatch(14101, dir));
  const serialized = serializeObservation(batch);
  assert.ok(!serialized.includes('sink_payload_sha256'));
  assert.ok(!serialized.includes('captureNonce'));
  assert.ok(!serialized.includes('labels'));
  const audit = buildObservationManifest(source, dir);
  assert.equal(audit.instances.length, 12);
  assert.equal(audit.instances[0].user_message_sha256, hash(serialized));
});

test('rehash does not bless receipt, stage, job, event, or answer tampering', () => {
  rewrite('captures-v1.json', (value) => {
    value.cases[0].receipts[0].profile_id = 'fake';
  });
  rewrite('captures-v1.json', (value) => {
    value.cases[0].stages[0].report_owner = 'fake';
  });
  rewrite('captures-v1.json', (value) => {
    value.cases[0].job_registry.at(-1).publisher_bindings[0].profile_id = 'fake';
  });
  rewrite('captures-v1.json', (value) => {
    value.cases[0].job_registry.at(-1).approved_cell_volume += 1;
  });
  rewrite('captures-v1.json', (value) => {
    value.cases[0].events[0].destination = 'fake';
  });
  rewrite('answers-v1.json', (value) => {
    value.cases[0].labels[Object.keys(value.cases[0].labels)[0]] = 'tampered';
  });
});

test('serialized observation rejects evaluator verdict and value fields', () => {
  const batch = loadBatch(14001, dir);
  batch.captures[0].covered = true;
  assert.throws(() => serializeObservation(batch), /forbidden visible key/u);
  delete batch.captures[0].covered;
  batch.captures[0].receipts[0].value = 'secret';
  assert.throws(() => serializeObservation(batch), /forbidden visible key/u);
});

test('lineage and manifest metadata remain exact after rehash', () => {
  const lineageFile = path.join(dir, 'field-lineage.json');
  const manifestFile = path.join(dir, 'capture-manifest.json');
  const originalLineage = fs.readFileSync(lineageFile);
  const originalManifest = fs.readFileSync(manifestFile);
  try {
    const lineage = JSON.parse(originalLineage);
    lineage.derived.pop();
    const lineageBytes = `${JSON.stringify(lineage, null, 2)}\n`;
    fs.writeFileSync(lineageFile, lineageBytes);
    const manifest = JSON.parse(originalManifest);
    manifest.field_lineage.sha256 = hash(lineageBytes);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => loadCorpus(dir), /lineage lacks an exact visible field/u);
  } finally {
    fs.writeFileSync(lineageFile, originalLineage);
    fs.writeFileSync(manifestFile, originalManifest);
  }
  const manifest = JSON.parse(originalManifest);
  manifest.consumer.task_id = 'wrong';
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    assert.throws(() => loadCorpus(dir));
  } finally {
    fs.writeFileSync(manifestFile, originalManifest);
  }
});
