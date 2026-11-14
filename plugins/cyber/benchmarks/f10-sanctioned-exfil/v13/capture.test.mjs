import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch, loadCorpus } from './capture-consumer.mjs';
import { CAPTURE_SEEDS, produceCase, verifyNativeProof, writeCorpus } from './capture-producer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function temporaryCorpus(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v13-corpus-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(
    path.join(here, 'evidence/field-lineage.json'),
    path.join(dir, 'field-lineage.json'),
  );
  writeCorpus('0'.repeat(40), dir);
  return dir;
}

test('native paired reference labels all completed flows and keeps mismatch blocked', (t) => {
  const dir = temporaryCorpus(t);
  const corpus = loadCorpus(dir);
  assert.equal(corpus.captures.cases.length, 72);
  for (const seed of CAPTURE_SEEDS) {
    const batch = loadBatch(seed, dir);
    assert.equal(batch.captures.length, 6);
    const blocked = produceCase(seed, 'publisher-mismatch');
    assert.equal(blocked.visible.events.length, 0);
    assert.equal(blocked.visible.flows.length, 0);
    assert.equal(blocked.visible.blocked_publish_attempts.length, 1);
    assert.equal(blocked.visible.blocked_publish_attempts[0].reason, 'publisher-owner-mismatch');
    assert.deepEqual(Object.values(produceCase(seed, 'covered-fanout').answer.labels), [
      'sanctioned-bulk',
      'sanctioned-bulk',
    ]);
  }
});

test('consumer rejects native owner, profile, stage, receipt, and job tampering', (t) => {
  const dir = temporaryCorpus(t);
  const capturesPath = path.join(dir, 'captures-v1.json');
  const original = JSON.parse(fs.readFileSync(capturesPath, 'utf8'));
  const mutations = [
    (capture) => {
      capture.stages[0].report_owner = 'forged-owner';
    },
    (capture) => {
      capture.publisher_profiles[0].actor_binding = 'forged-owner';
    },
    (capture) => {
      capture.receipts[0].stage_ref = 'forged-stage';
    },
    (capture) => {
      capture.receipts[0].event_id = 'forged-event';
    },
    (capture) => {
      capture.job_registry[0].actor_binding = ['forged-owner'];
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    const target = changed.cases.find(
      (capture) => capture.stages.length && capture.receipts.length,
    );
    mutate(target);
    const bytes = `${JSON.stringify(changed, null, 2)}\n`;
    fs.writeFileSync(capturesPath, bytes);
    const manifestPath = path.join(dir, 'capture-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files.find((entry) => entry.path === 'captures-v1.json').sha256 = hash(bytes);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => loadCorpus(dir));
  }
});

test('native sink proof rejects altered delivered cell value', () => {
  const proof = structuredClone(produceCase(13001, 'malicious-fanout').proof);
  proof.sink[0].cells[0].value = 'forged';
  assert.throws(() => verifyNativeProof(proof));
});
