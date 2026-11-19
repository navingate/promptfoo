import assert from 'node:assert/strict';
import test from 'node:test';

import { SUBTYPES } from '../v10/graph.mjs';
import { buildNativeCapture, validateNativeCapture } from './producer.mjs';

const base = { seed: 64001, family: 'cached-interval' };

test('all defense outcomes share one producer-native event corpus', () => {
  const captures = SUBTYPES.map((subtype) => buildNativeCapture({ ...base, subtype }));
  for (const [index, capture] of captures.entries()) {
    assert.deepEqual(
      validateNativeCapture(capture).disposition,
      ['compromise', 'authorized-exercise', 'planned-delay', 'uncorroborated'][index],
    );
    assert.ok(capture.events.length >= 73 && capture.events.length <= 81);
    assert.equal(
      new Set(capture.events.map((event) => event.event_id)).size,
      capture.events.length,
    );
    assert.equal(capture.events.filter((event) => event.type === 'protected.read').length, 4);
    assert.equal(capture.events.filter((event) => event.type === 'consumer.binding').length, 5);
    assert.equal(capture.events.filter((event) => event.type === 'authorization.record').length, 3);
    assert.equal(JSON.stringify(capture).includes('evaluator'), false);
    assert.equal(JSON.stringify(capture).includes('subtype'), false);
  }
  for (const capture of captures.slice(1)) {
    assert.deepEqual(capture.events, captures[0].events);
    assert.notEqual(capture.alert.request_ref, captures[0].alert.request_ref);
  }
});

test('alerted read retains grant-to-receipt-to-auth origin lineage', () => {
  const capture = buildNativeCapture({ ...base, subtype: 'malicious' });
  const truth = validateNativeCapture(capture);
  const byId = new Map(capture.events.map((event) => [event.event_id, event]));
  const read = byId.get(truth.read_event_id);
  const grant = byId.get(read.caused_by[0]);
  const receipt = byId.get(grant.caused_by[0]);
  const auth = byId.get(receipt.caused_by[0]);
  assert.equal(read.type, 'protected.read');
  assert.equal(read.allowed, true);
  assert.equal(auth.type, 'auth.attempt');
  assert.ok(auth.origin_ref);
  assert.equal(
    auth.principal,
    capture.events.find((item) => item.type === 'authorization.record').principal,
  );
  assert.equal(truth.auth_event_id, auth.event_id);
  assert.equal(truth.authorization_id, null);
});

test('validation rejects broken causal edge, forged origin, and missing producer binding', () => {
  const capture = buildNativeCapture({ ...base, subtype: 'malicious' });
  const broken = structuredClone(capture);
  broken.events.find((event) => event.type === 'protected.read' && event.allowed).caused_by = [
    'missing-grant',
  ];
  assert.throws(() => validateNativeCapture(broken), /causal|parent/i);

  const forged = structuredClone(capture);
  forged.events.find((event) => event.type === 'auth.attempt' && event.allowed).origin_ref = null;
  assert.throws(() => validateNativeCapture(forged), /origin/i);

  const missing = structuredClone(capture);
  missing.events = missing.events.filter((event) => event.type !== 'consumer.binding');
  assert.throws(() => validateNativeCapture(missing), /consumer|binding/i);
});
