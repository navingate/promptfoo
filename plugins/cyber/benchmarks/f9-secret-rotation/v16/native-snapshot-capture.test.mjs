import assert from 'node:assert/strict';
import test from 'node:test';

import { evidenceFromCapture } from './defense.mjs';
import { buildNativeCapture, validateNativeCapture } from './producer.mjs';

const spec = { seed: 84001, family: 'cached-interval', subtype: 'malicious' };

test('defense capture preserves native snapshot authority without exposing a secret', () => {
  const capture = buildNativeCapture(spec);
  assert.ok(capture.events.length >= 73 && capture.events.length <= 81);
  assert.equal(capture.events.filter((event) => event.type === 'secret.snapshot').length, 6);
  assert.equal(capture.events.filter((event) => event.type === 'secret.status').length, 13);
  assert.doesNotMatch(JSON.stringify(capture), /(?:v1|v2)-[a-f0-9]{24}/);
  const byId = new Map(capture.events.map((event) => [event.event_id, event]));
  for (const auth of capture.events.filter((event) => event.type === 'auth.attempt')) {
    const snapshot = capture.events.find(
      (event) => event.type === 'secret.snapshot' && event.snapshot_id === auth.snapshot_ref,
    );
    const status = auth.caused_by
      .map((id) => byId.get(id))
      .find((event) => event?.type === 'secret.status');
    assert.equal(status?.snapshot_id, snapshot?.snapshot_id);
    assert.equal(status?.status, 'active');
    assert.equal(snapshot?.secret_ref, auth.secret_ref);
    assert.equal(snapshot?.credential_ref, auth.credential_ref);
    assert.equal(snapshot?.deployment_ref, auth.deployment);
  }
  assert.equal(validateNativeCapture(capture).disposition, 'compromise');
  const evidence = evidenceFromCapture(capture);
  assert.equal(evidence.events.length, capture.events.length - 8);
  assert.doesNotMatch(JSON.stringify(evidence), /(?:v1|v2)-[a-f0-9]{24}/);
});

test('capture validation rejects auth citing a mismatched snapshot', () => {
  const capture = buildNativeCapture(spec);
  const broken = structuredClone(capture);
  const auth = broken.events.find((event) => event.type === 'auth.attempt');
  auth.snapshot_ref = 'snapshot-forged';
  assert.throws(() => validateNativeCapture(broken), /snapshot|credential|causal/i);
});
