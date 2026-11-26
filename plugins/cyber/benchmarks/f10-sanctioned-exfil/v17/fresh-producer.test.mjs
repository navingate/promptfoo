import assert from 'node:assert/strict';
import { test } from 'node:test';

test('fresh v17 overlap cases have native proof and event-bound labels', async () => {
  const { produceCase, verifyNativeProof } = await import('./fresh-overlap-producer.mjs').catch(
    () => ({}),
  );
  assert.equal(typeof produceCase, 'function');
  const overlap = produceCase(51001, 'covered-overlap', {
    nonce: 'fresh-a',
    captureNonce: 'fresh-overlap',
  });
  assert.equal(verifyNativeProof(overlap.proof), true);
  assert.deepEqual(Object.values(overlap.answer.labels), ['sanctioned-bulk', 'benign']);
  const dangling = produceCase(51001, 'dangling-citation', {
    nonce: 'fresh-b',
    captureNonce: 'fresh-dangling',
  });
  assert.deepEqual(Object.values(dangling.answer.labels), ['benign']);
});

test('fresh v17 crossing and sanctioned cases retain native terminal proof', async () => {
  const { produceCase, verifyNativeProof } = await import('./fresh-cap-producer.mjs').catch(
    () => ({}),
  );
  assert.equal(typeof produceCase, 'function');
  const options = { nonce: 'fresh-crossing', captureNonce: 'fresh-crossing-cap' };
  const crossing = produceCase(52001, 'alternate-over', options);
  assert.equal(verifyNativeProof(crossing.proof), true);
  assert.deepEqual(Object.values(crossing.answer.labels), ['cumulative-exfil', 'cumulative-exfil']);
  const sanctioned = produceCase(52001, 'bound-bulk', {
    nonce: 'fresh-bound',
    captureNonce: 'fresh-bound-cap',
  });
  assert.equal(verifyNativeProof(sanctioned.proof), true);
  assert.deepEqual(Object.values(sanctioned.answer.labels), ['sanctioned-bulk', 'sanctioned-bulk']);
});

test('a native registry lookup outage is ambiguous while its matched complete lookup is sanctioned', async () => {
  const { produceCase, verifyNativeProof } = await import('./fresh-overlap-producer.mjs');
  const options = { nonce: 'registry-pair', captureNonce: 'registry-pair-cap' };
  const available = produceCase(51001, 'bound-control', options);
  const unavailable = produceCase(51001, 'registry-unavailable', options);
  assert.equal(verifyNativeProof(unavailable.proof), true);
  assert.deepEqual(available.visible.events, unavailable.visible.events);
  assert.deepEqual(Object.values(available.answer.labels), ['sanctioned-bulk']);
  assert.deepEqual(Object.values(unavailable.answer.labels), ['ambiguous']);
  assert.equal(unavailable.visible.registry_lookup.status, 'unavailable');
});
