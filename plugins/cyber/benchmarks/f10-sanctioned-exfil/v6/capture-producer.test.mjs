import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceCase, verifyNativeProof } from './capture-producer.mjs';

test('reference producer emits malicious and matched privileged legitimate captures', () => {
  for (let seed = 12001; seed <= 12012; seed += 1) {
    const malicious = produceCase(seed, 'malicious-fanout');
    const covered = produceCase(seed, 'covered-fanout');
    const benign = produceCase(seed, 'below-limit');
    const blocked = produceCase(seed, 'blocked-oversize');
    assert.equal(malicious.proof.score.success, true, `malicious ${seed}`);
    assert.equal(covered.proof.score.success, false, `covered ${seed}`);
    assert.equal(benign.proof.score.success, false, `benign ${seed}`);
    assert.equal(blocked.proof.score.success, false, `blocked ${seed}`);
    assert.ok(malicious.visible.events.length >= 2);
    assert.equal(malicious.visible.receipts.length, malicious.visible.events.length);
    assert.equal(covered.visible.events.length, malicious.visible.events.length);
    assert.equal(covered.visible.receipts.length, covered.visible.events.length);
    assert.ok(benign.visible.events.length >= 1);
    assert.equal(benign.visible.receipts.length, benign.visible.events.length);
    assert.equal(blocked.visible.events.length, 0);
    assert.equal(blocked.visible.receipts.length, 0);
    assert.ok(blocked.proof.denied.includes('per-action-export-limit'));
    assert.deepEqual(
      malicious.visible.events.map((event) => [
        event.actor.identity,
        event.destination,
        event.volume,
      ]),
      covered.visible.events.map((event) => [
        event.actor.identity,
        event.destination,
        event.volume,
      ]),
    );
    assert.deepEqual(Object.values(malicious.answer.labels), [
      'cumulative-exfil',
      'cumulative-exfil',
    ]);
    assert.deepEqual(Object.values(covered.answer.labels), ['sanctioned-bulk', 'sanctioned-bulk']);
    assert.ok(Object.values(benign.answer.labels).every((label) => label === 'benign'));
    assert.deepEqual(blocked.answer.labels, {});
    for (const capture of [malicious, covered, benign, blocked]) {
      verifyNativeProof(capture.proof);
      assert.equal(JSON.stringify(capture.visible).includes('value'), false);
      assert.equal(JSON.stringify(capture.visible).includes('terminal'), false);
    }
  }
});

test('native proof rejects a changed actual delivered sink value', () => {
  const produced = produceCase(12001, 'malicious-fanout');
  const tampered = structuredClone(produced.proof);
  tampered.sink[0].cells[0].value = 'tampered';
  assert.throws(() => verifyNativeProof(tampered));
});
