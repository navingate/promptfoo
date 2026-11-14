import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTwin, FAMILIES, SUBTYPES, validateTwin } from './graph.mjs';

const spec = { seed: 25001, family: 'cached-interval', subtype: 'malicious' };
const copy = (value) => structuredClone(value);
const event = (capture, type) => capture.events.find((item) => item.type === type);

test('deterministic paired native captures differ only at protected read lineage', () => {
  for (const family of FAMILIES) {
    for (const subtype of SUBTYPES) {
      const input = { seed: 25001, family, subtype };
      const benign = buildTwin({ ...input, malicious: false });
      const malicious = buildTwin({ ...input, malicious: true });
      assert.deepEqual(buildTwin({ ...input, malicious: false }), benign);
      assert.deepEqual(buildTwin({ ...input, malicious: true }), malicious);
      assert.notEqual(
        event(benign, 'protected.read').caused_by[0],
        event(malicious, 'protected.read').caused_by[0],
      );
      const normalized = copy(malicious);
      event(normalized, 'protected.read').caused_by = event(benign, 'protected.read').caused_by;
      assert.deepEqual(normalized, benign);
      assert.equal(
        validateTwin(benign).disposition,
        {
          malicious: 'authorized',
          breakglass: 'authorized-exercise',
          planned: 'planned-delay',
          'false-positive': 'uncorroborated',
        }[subtype],
      );
      assert.equal(validateTwin(malicious).disposition, 'compromise');
      assert.equal(benign.events.length, malicious.events.length);
      assert.ok(benign.events.length <= 72);
      assert.ok(new Set(benign.events.map((item) => item.flow_id)).size <= 4);
    }
  }
});

test('authorization and actor order vary across seeds', () => {
  const captures = Array.from({ length: 32 }, (_, offset) =>
    buildTwin({ ...spec, seed: 26000 + offset, malicious: false }),
  );
  const authPositions = captures.map((capture) => {
    const policy = event(capture, 'authorization.record');
    return capture.events
      .filter((item) => item.type === 'auth.attempt')
      .findIndex((item) => item.actor === policy.principal);
  });
  assert.deepEqual(new Set(authPositions), new Set([0, 1]));
  assert.ok(
    new Set(
      captures.map((capture) => capture.events.findIndex((item) => item.type === 'protected.read')),
    ).size > 1,
  );
  assert.ok(
    new Set(captures.map((capture) => event(capture, 'protected.read').caused_by[0])).size > 1,
  );
});

test('rejects missing, cross-flow, and time-inverted causal edges', () => {
  const base = buildTwin({ ...spec, malicious: false });
  const auth = base.events.find(
    (item) =>
      item.type === 'auth.attempt' && item.actor === event(base, 'authorization.record').principal,
  );
  const receipt = base.events.find(
    (item) => item.type === 'auth.receipt' && item.flow_id === auth.flow_id,
  );
  const grant = base.events.find(
    (item) => item.type === 'grant.redeem' && item.flow_id === auth.flow_id,
  );
  const otherReceipt = base.events.find(
    (item) => item.type === 'auth.receipt' && item.flow_id !== auth.flow_id,
  );
  const cases = [
    (capture) => {
      event(capture, 'protected.read').caused_by = ['missing'];
    },
    (capture) => {
      capture.events.find((item) => item.event_id === grant.event_id).caused_by = [
        otherReceipt.event_id,
      ];
    },
    (capture) => {
      capture.events.find((item) => item.event_id === receipt.event_id).caused_by = ['missing'];
    },
    (capture) => {
      capture.events.find((item) => item.event_id === receipt.event_id).event_time =
        auth.event_time - 1;
    },
    (capture) => {
      capture.events.find((item) => item.event_id === grant.event_id).event_time =
        receipt.event_time - 1;
    },
    (capture) => {
      event(capture, 'protected.read').event_time = grant.event_time - 1;
    },
    (capture) => {
      capture.events.find((item) => item.event_id === auth.event_id).actor = 'forged';
    },
    (capture) => {
      capture.events.find((item) => item.event_id === grant.event_id).flow_id = 'forged';
    },
    (capture) => {
      capture.events[0].event_id = capture.events[1].event_id;
    },
    (capture) => {
      event(capture, 'protected.read').flow_id = auth.flow_id;
    },
    (capture) => {
      for (const item of capture.events) {
        delete item.resource;
      }
    },
  ];
  for (const mutate of cases) {
    const capture = copy(base);
    mutate(capture);
    assert.throws(() => validateTwin(capture));
  }
});
