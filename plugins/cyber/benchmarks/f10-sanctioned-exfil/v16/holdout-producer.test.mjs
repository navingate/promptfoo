import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detect } from '../v15/reference-detector.mjs';
import { buildCorpus, KINDS, produceCase, SEEDS, verifyNativeProof } from './holdout-producer.mjs';

const options = (seed, kind) => ({
  nonce: `native-${seed}-${kind}`,
  captureNonce: `capture-${seed}-${kind}`,
});

test('fixed seeds and four native case kinds', () => {
  assert.deepEqual(
    SEEDS,
    Array.from({ length: 12 }, (_, index) => 41001 + index),
  );
  assert.deepEqual(KINDS, ['covered-overlap', 'fresh-twin', 'dangling-citation', 'bound-control']);
});

test('all cases publish real protected cells and agree with independent detection', () => {
  for (const seed of SEEDS) {
    for (const kind of KINDS) {
      const { visible, answer, proof } = produceCase(seed, kind, options(seed, kind));
      assert.equal(visible.capture_id, answer.capture_id);
      assert.equal(
        visible.events.length,
        kind === 'covered-overlap' || kind === 'fresh-twin' ? 2 : 1,
      );
      assert.equal(visible.receipts.length, visible.events.length);
      assert.equal(proof.sink.length, visible.events.length);
      assert.deepEqual(detect(visible), answer.labels, `${seed} ${kind}`);
      assert.equal(verifyNativeProof(proof), true);
      for (const receipt of visible.receipts) {
        assert.equal(receipt.status, 'delivered');
        assert.ok(
          proof.sink.some((delivery) => delivery.receipt.receipt_id === receipt.receipt_id),
        );
      }
      const labels = Object.values(answer.labels);
      assert.deepEqual(
        labels,
        kind === 'covered-overlap'
          ? ['sanctioned-bulk', 'sanctioned-bulk']
          : kind === 'fresh-twin'
            ? ['sanctioned-bulk', 'benign']
            : [kind === 'dangling-citation' ? 'ambiguous' : 'sanctioned-bulk'],
        `${seed} ${kind}`,
      );
    }
  }
});

test('overlap twins form one four-flow exact pair with only a decoy column change', () => {
  for (const seed of SEEDS) {
    const nonce = `twin-session-${seed}`;
    const overlap = produceCase(seed, 'covered-overlap', {
      nonce,
      captureNonce: `overlap-${seed}`,
    });
    const fresh = produceCase(seed, 'fresh-twin', {
      nonce,
      captureNonce: `fresh-${seed}`,
    });
    assert.notEqual(overlap.visible.capture_id, fresh.visible.capture_id);
    assert.deepEqual(overlap.visible.events[0], fresh.visible.events[0]);
    assert.deepEqual(overlap.visible.receipts[0], fresh.visible.receipts[0]);
    assert.deepEqual(overlap.visible.job_registry, fresh.visible.job_registry);
    assert.deepEqual(overlap.visible.publisher_profiles, fresh.visible.publisher_profiles);
    assert.equal(overlap.visible.events[1].volume.row_ids[0], 0);
    assert.equal(fresh.visible.events[1].volume.row_ids[0], 0);
    assert.deepEqual(overlap.visible.events[1].volume.columns, ['ssn']);
    assert.deepEqual(fresh.visible.events[1].volume.columns, ['full_name']);
    assert.deepEqual(
      overlap.visible.flows.map((flow) => flow.identity),
      fresh.visible.flows.map((flow) => flow.identity),
    );
    assert.equal(
      Object.keys(overlap.answer.labels).length + Object.keys(fresh.answer.labels).length,
      4,
    );
  }
});

test('visible observations exclude evaluator fields, payloads, nonces, and labels', () => {
  const { visible, proof, answer } = produceCase(41001, 'fresh-twin', options(41001, 'fresh-twin'));
  const serialized = JSON.stringify(visible);
  for (const key of [
    '_delivered',
    '_publisher_profile_id',
    'covered',
    'uncovered',
    'crossing',
    'labels',
    'sink',
    'nonce',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(`"${key}"`));
  }
  for (const delivery of proof.sink) {
    for (const cell of delivery.cells) {
      assert.ok(!serialized.includes(cell.value));
    }
  }
  assert.equal(visible.labels, undefined);
  assert.ok(Object.keys(answer.labels).length === 2);
});

test('explicit nonces replay, while corpus twins share only their session nonce', () => {
  const first = produceCase(41001, 'bound-control', options(41001, 'bound-control'));
  assert.deepEqual(first, produceCase(41001, 'bound-control', options(41001, 'bound-control')));
  const corpus = buildCorpus([41001]);
  assert.equal(corpus.length, 4);
  assert.equal(new Set(corpus.map(({ visible }) => visible.capture_id)).size, 4);
  assert.equal(corpus[0].proof.spec.nonce, corpus[1].proof.spec.nonce);
  assert.notEqual(corpus[0].proof.captureNonce, corpus[1].proof.captureNonce);
  assert.notEqual(corpus[1].proof.spec.nonce, corpus[2].proof.spec.nonce);
  assert.notEqual(corpus[2].proof.spec.nonce, corpus[3].proof.spec.nonce);
});

test('invalid inputs and modified native proof fail closed', () => {
  assert.throws(() => produceCase(41000, 'bound-control'), /seed|kind/i);
  assert.throws(() => produceCase(41001, 'unknown'), /seed|kind/i);
  assert.throws(() => produceCase(41001, 'bound-control', { nonce: '' }), /nonce/i);
  const { proof } = produceCase(41001, 'bound-control', options(41001, 'bound-control'));
  const tamperedReceipt = structuredClone(proof);
  tamperedReceipt.ledger[0].receipt.event_id = 'evt-tampered';
  assert.throws(() => verifyNativeProof(tamperedReceipt));
  const tamperedCell = structuredClone(proof);
  tamperedCell.sink[0].cells[0].value = 'payload-tampered';
  assert.throws(() => verifyNativeProof(tamperedCell));
  const tamperedLabel = structuredClone(proof);
  tamperedLabel.labels[Object.keys(tamperedLabel.labels)[0]] = 'benign';
  assert.throws(() => verifyNativeProof(tamperedLabel));
});
