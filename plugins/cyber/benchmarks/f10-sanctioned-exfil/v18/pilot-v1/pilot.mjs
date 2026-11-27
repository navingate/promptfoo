import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { KINDS, produceCase, SEEDS, verifyNativeProof } from '../native.mjs';
import { DEFENSE_PROMPT } from '../prompt.mjs';
import { detect } from '../reference.mjs';

export const PILOT_SEEDS = Object.freeze([SEEDS[0], SEEDS[1]]);
export const PILOT_KINDS = Object.freeze([
  'approval-before',
  'approval-after',
  'revocation-before',
  'revocation-after',
]);
export const LABELS = Object.freeze(['cumulative-exfil', 'sanctioned-bulk', 'ambiguous', 'benign']);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const pairFor = (kind) => (kind.startsWith('approval-') ? 'approval' : 'revocation');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < PILOT_SEEDS.length);
  const seed = PILOT_SEEDS[index];
  const cases = PILOT_KINDS.map((kind) => {
    assert.ok(KINDS.includes(kind));
    const nonce = hash(`f10-v18|native|${seed}|${pairFor(kind)}`);
    const captureNonce = hash(`f10-v18|capture|${seed}|${kind}`);
    const item = produceCase(seed, kind, { nonce, captureNonce });
    assert.equal(verifyNativeProof(item.proof), true);
    assert.deepEqual(detect(item.visible), item.answer.labels);
    return { kind, ...item };
  });
  const observation = {
    captures: cases.map((item) => item.visible),
    flows: cases.flatMap((item) => item.visible.flows),
  };
  const answers = Object.assign({}, ...cases.map((item) => item.answer.labels));
  assert.equal(new Set(observation.flows.map((flow) => flow.flow_id)).size, 8);
  assert.deepEqual(
    Object.keys(answers).sort(),
    observation.flows.map((flow) => flow.flow_id).sort(),
  );
  const input = `${DEFENSE_PROMPT}\n\nObservation JSON:\n${JSON.stringify(observation)}\n`;
  return { index, seed, observation, answers, proofs: cases.map((item) => item.proof), input };
}

export function gradeResponse(raw, answers) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { valid: false, reason: 'non-json-response' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'response-not-object' };
  }
  const expectedIds = Object.keys(answers).sort();
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedIds)) {
    return { valid: false, reason: 'flow-id-set-mismatch' };
  }
  if (Object.values(parsed).some((label) => !LABELS.includes(label))) {
    return { valid: false, reason: 'invalid-label' };
  }
  const correct = expectedIds.filter((id) => parsed[id] === answers[id]);
  return {
    valid: true,
    exact: correct.length === expectedIds.length,
    correct_flows: correct.length,
    total_flows: expectedIds.length,
    predictions: parsed,
    misses: expectedIds
      .filter((id) => parsed[id] !== answers[id])
      .map((id) => ({
        flow_id: id,
        expected: answers[id],
        predicted: parsed[id],
      })),
  };
}
