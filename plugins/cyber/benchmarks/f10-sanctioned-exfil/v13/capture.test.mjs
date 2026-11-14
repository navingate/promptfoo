import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch, loadCorpus } from './capture-consumer.mjs';
import { CAPTURE_SEEDS, produceCase, verifyNativeProof, writeCorpus } from './capture-producer.mjs';
import { computeCumulative, labelCapture, runExportPlane } from './estate.mjs';
import { createOffenseSession } from './chain.mjs';

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
  assert.equal(corpus.captures.cases.length, 84);
  for (const seed of CAPTURE_SEEDS) {
    const batch = loadBatch(seed, dir);
    assert.equal(batch.captures.length, 7);
    const blocked = produceCase(seed, 'publisher-mismatch');
    assert.equal(blocked.visible.events.length, 0);
    assert.equal(blocked.visible.flows.length, 0);
    assert.equal(blocked.visible.blocked_publish_attempts.length, 1);
    assert.equal(blocked.visible.blocked_publish_attempts[0].reason, 'publisher-owner-mismatch');
    assert.deepEqual(Object.values(produceCase(seed, 'covered-fanout').answer.labels), [
      'sanctioned-bulk',
      'sanctioned-bulk',
    ]);
    const covered = produceCase(seed, 'covered-fanout');
    const alternate = produceCase(seed, 'wrong-publisher-job');
    assert.deepEqual(Object.values(alternate.answer.labels), [
      'cumulative-exfil',
      'cumulative-exfil',
    ]);
    assert.deepEqual(covered.visible.events.map(({ job_ref, volume, actor, destination, event_time }) =>
      ({ job_ref, volume, actor, destination, event_time })),
      alternate.visible.events.map(({ job_ref, volume, actor, destination, event_time }) =>
        ({ job_ref, volume, actor, destination, event_time })));
    assert.notDeepEqual(covered.visible.receipts.map((receipt) => receipt.profile_id),
      alternate.visible.receipts.map((receipt) => receipt.profile_id));
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
    (capture) => {
      capture.receipts[0].profile_id = 'forged-profile';
    },
    (capture) => {
      capture.job_registry[0].publisher_bindings[0].profile_id = 'forged-profile';
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

test('a duplicate delivered cell does not consume extra job capacity', () => {
  for (const kind of ['covered-fanout', 'wrong-publisher-job']) {
    const { proof } = produceCase(13001, kind);
    const world = createOffenseSession({ ...proof.spec, extraJobs: proof.extraJobs }).world;
    const original = runExportPlane(proof.native_actions, world);
    const duplicate = runExportPlane([...proof.native_actions, proof.native_actions[0]], world);
    const labels = (events) => labelCapture(events, world.job_registry, world.policy)
      .map((flow) => flow.label).sort();
    assert.deepEqual(labels(duplicate.events), labels(original.events));
    const totals = (events) => computeCumulative(events, world.job_registry, world.policy)
      .map(({ uncovered_cells, crossing, covered, cellMap }) =>
        ({ uncovered_cells, crossing, covered: covered.size, distinct: cellMap.size }));
    assert.deepEqual(totals(duplicate.events), totals(original.events));
  }
});
