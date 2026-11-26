import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { KINDS, produceCase, SEEDS, verifyNativeProof } from './native.mjs';
import { detect } from './reference.mjs';

export const BATCH_COUNT = SEEDS.length;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const pairFor = (kind) => {
  if (kind.startsWith('approval-')) {
    return 'approval';
  }
  if (kind.startsWith('revocation-')) {
    return 'revocation';
  }
  if (kind.startsWith('profile-')) {
    return 'profile';
  }
  if (kind.startsWith('scope-')) {
    return 'scope';
  }
  if (kind.startsWith('overlap-')) {
    return 'overlap';
  }
  return kind;
};

export function buildBatch(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < BATCH_COUNT);
  const seed = SEEDS[index];
  const cases = KINDS.map((kind) => {
    const nonce = hash(`f10-v18|native|${seed}|${pairFor(kind)}`);
    const captureNonce = hash(`f10-v18|capture|${seed}|${kind}`);
    const item = produceCase(seed, kind, { nonce, captureNonce });
    assert.equal(verifyNativeProof(item.proof), true);
    assert.deepEqual(detect(item.visible), item.answer.labels);
    return item;
  });
  const captures = cases.map((item) => item.visible);
  const flows = captures.flatMap((capture) => capture.flows);
  const labels = Object.assign({}, ...cases.map((item) => item.answer.labels));
  assert.equal(new Set(flows.map((flow) => flow.flow_id)).size, flows.length);
  return {
    index,
    seed,
    captures,
    flows,
    labels,
    proofs: cases.map((item) => item.proof),
  };
}
