import assert from 'node:assert/strict';

import {
  CAPTURE_KINDS as CAP_KINDS,
  CAPTURE_SEEDS as CAP_SEEDS,
  produceCase as capCase,
  verifyNativeProof as verifyCap,
} from './fresh-cap-producer.mjs';
import {
  KINDS as OVERLAP_KINDS,
  SEEDS as OVERLAP_SEEDS,
  produceCase as overlapCase,
  verifyNativeProof as verifyOverlap,
} from './fresh-overlap-producer.mjs';
import { detect } from './reference.mjs';

export const BATCH_COUNT = 12;

export function buildBatch(index) {
  if (!Number.isInteger(index) || index < 0 || index >= BATCH_COUNT) {
    throw new Error('invalid v17 batch index');
  }
  const capSeed = CAP_SEEDS[index];
  const overlapSeed = OVERLAP_SEEDS[index];
  const produced = [];
  for (const kind of CAP_KINDS) {
    const pair = kind.startsWith('alternate-')
      ? 'alternate'
      : kind.startsWith('mixed-cap-')
        ? 'mixed'
        : kind;
    const item = capCase(capSeed, kind, {
      nonce: `v17-cap-${capSeed}-${pair}`,
      captureNonce: `v17-cap-${capSeed}-${kind}`,
    });
    assert.equal(verifyCap(item.proof), true);
    produced.push(item);
  }
  for (const kind of OVERLAP_KINDS) {
    const pair =
      kind === 'covered-overlap' || kind === 'fresh-twin'
        ? 'overlap'
        : kind === 'registry-unavailable'
          ? 'bound-control'
          : kind;
    const item = overlapCase(overlapSeed, kind, {
      nonce: `v17-overlap-${overlapSeed}-${pair}`,
      captureNonce: `v17-overlap-${overlapSeed}-${kind}`,
    });
    assert.equal(verifyOverlap(item.proof), true);
    produced.push(item);
  }
  const captures = produced.map((item) => item.visible);
  const flows = captures.flatMap((capture) => capture.flows);
  const labels = Object.assign({}, ...produced.map((item) => item.answer.labels));
  assert.equal(new Set(flows.map((flow) => flow.flow_id)).size, flows.length);
  assert.deepEqual(Object.assign({}, ...captures.map(detect)), labels);
  return {
    index,
    capSeed,
    overlapSeed,
    captures,
    flows,
    labels,
    proofs: produced.map((item) => item.proof),
  };
}
