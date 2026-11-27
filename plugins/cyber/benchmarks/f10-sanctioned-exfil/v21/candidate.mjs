import assert from 'node:assert/strict';

import { KINDS, produceCase, SEEDS, verifyNativeProof } from './native.mjs';
import { deliveryRanges } from './presentation.mjs';
import { auditIncident } from './reference.mjs';

export const SCREEN_SEEDS = Object.freeze([
  61007,
  ...Array.from({ length: 12 }, (_, index) => 62001 + index),
]);

export function buildCase(seed, kind) {
  assert.ok(SEEDS.includes(seed) && KINDS.includes(kind));
  const pair = kind.startsWith('revision') ? 'revision' : 'receipt';
  const item = produceCase(seed, kind, {
    nonce: `f10-v21|native|${seed}|${pair}`,
    captureNonce: `f10-v21|capture|${seed}|${pair}`,
  });
  assert.equal(verifyNativeProof(item.proof), true);
  assert.deepEqual(auditIncident(item.visible), item.answer.report);
  const observation = {
    capture: item.visible,
    delivery_ranges: deliveryRanges(item.visible),
  };
  return { seed, kind, ...item, observation };
}
