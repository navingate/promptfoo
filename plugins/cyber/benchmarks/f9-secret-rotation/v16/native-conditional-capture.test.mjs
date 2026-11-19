import assert from 'node:assert/strict';
import test from 'node:test';

import { SUBTYPES } from '../v10/graph.mjs';
import { evidenceFromCapture } from './defense.mjs';
import { buildNativeCapture, validateNativeCapture } from './producer.mjs';

const base = { seed: 102001, family: 'cached-interval' };

test('paired captures preserve all accepted authentication receipts and effective states', () => {
  const captures = SUBTYPES.map((subtype) => buildNativeCapture({ ...base, subtype }));
  const expected = ['compromise', 'authorized-exercise', 'planned-delay', 'uncorroborated'];
  for (const [index, capture] of captures.entries()) {
    assert.equal(validateNativeCapture(capture).disposition, expected[index]);
    assert.ok(capture.events.length >= 73 && capture.events.length <= 81);
    assert.equal(
      new Set(capture.events.map((event) => event.event_id)).size,
      capture.events.length,
    );
    assert.equal(capture.events.filter((event) => event.type === 'secret.snapshot').length, 6);
    assert.equal(capture.events.filter((event) => event.type === 'secret.status').length, 13);
    assert.equal(capture.events.filter((event) => event.type === 'authorization.status').length, 5);
    assert.ok(
      capture.events.some(
        (event) =>
          event.type === 'authorization.status' &&
          event.status === 'revoked' &&
          event.effective_at > capture.alert.window_end,
      ),
    );
    assert.ok(
      capture.events
        .filter((event) => event.type === 'secret.status')
        .every((event) => Number.isSafeInteger(event.effective_at)),
    );
    assert.doesNotMatch(JSON.stringify(capture), /(?:v1|v2)-[a-f0-9]{24}/);
  }
  for (const capture of captures.slice(1)) {
    assert.deepEqual(capture.events, captures[0].events);
  }
  const evidence = evidenceFromCapture(captures[0]);
  assert.equal(evidence.events.length, captures[0].events.length - 8);
  assert.ok(
    evidence.events.some(
      (event) => event.type === 'secret.status' && Number.isSafeInteger(event.effective_at),
    ),
  );
  assert.ok(
    evidence.events.some(
      (event) => event.type === 'authorization.status' && Number.isSafeInteger(event.effective_at),
    ),
  );
});

test('some producer flows keep the speculative accepted receipt before the entitled one', () => {
  let found = false;
  for (let seed = 102001; seed <= 102009; seed += 1) {
    const capture = buildNativeCapture({ ...base, seed, subtype: 'malicious' });
    const byFlow = Map.groupBy(
      capture.events.filter((event) => ['auth.attempt', 'auth.receipt'].includes(event.type)),
      (event) => event.flow_id,
    );
    found ||= [...byFlow.values()].some(
      (events) => events.filter((event) => event.type === 'auth.receipt').length === 2,
    );
  }
  assert.equal(found, true);
});

test('capture validation rejects a forged effective status cited by authentication', () => {
  const capture = buildNativeCapture({ ...base, subtype: 'malicious' });
  const broken = structuredClone(capture);
  const auth = broken.events.find((event) => event.type === 'auth.attempt' && event.allowed);
  const status = broken.events.find(
    (event) => event.type === 'secret.status' && auth.caused_by.includes(event.event_id),
  );
  status.effective_at = 1200;
  assert.throws(() => validateNativeCapture(broken), /effective|snapshot|auth/i);
});
