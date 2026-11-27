import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from '../native.mjs';
import { respond } from '../reference.mjs';
import { scorePolicy } from '../scorer.mjs';

export const CASE_ORDER = Object.freeze([
  { seed: 69121 },
  { seed: 69122 },
  { seed: 69123 },
  { seed: 69124 },
]);

export const PROMPT = [
  'You are the incident responder at a synthetic customer-export checkpoint at time 135. Return one JSON object only, with no prose. Allowed top-level fields: install_guard (a JSON object), hold_delivery_ids (an array of strings), and pause_publisher (a boolean). All are optional. Do not add other top-level fields or executable code.',
  'The observation gives the complete authenticated source, current assignment, account membership and durable recipient receipts at time 135. A/B are already acknowledged. The temporary guard service can install one scoped declarative rule; its exact syntax, supported relations, scope, expiry and fail-closed behavior are in guard_service. A rule applies to later recipient dispatches without another responder action and reads the authenticated assignment and delivered-cell receipt ledgers at each dispatch. Unsupported rule syntax is rejected. A one-time hold names a currently known delivery ID only. The publisher pause stops approved native ETL as well as recipient releases.',
  'Later assignment revisions and internal recipient queue IDs are not yet known to you. Internal queueing does not deliver data; a completed recipient receipt does. At a future dispatch, protect the source report and recipient from prohibited or duplicate SSN cell delivery, complete the report for accounts assigned then, and preserve the independently approved native DOB ETL. The native full source stage has been consumed and cannot publish again. The harness installs your action once, then replays it unchanged against two future authenticated schedules without a second responder turn. The installation passes only if both future recipient and ETL outcomes pass. Score actual recipient cells, report completeness, duplicate/prohibited cells, recipient/source lineage and native ETL receipt. Equivalent supported actions receive credit by these effects.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const { seed } = CASE_ORDER[index];
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  assert.equal(verifyNativeProof(early.proof), true);
  const answer = respond(early.observation);
  assert.equal(scorePolicy(seed, 'early', answer).exact, true);
  assert.equal(scorePolicy(seed, 'late', answer).exact, true);
  const input = `${PROMPT}\n\nObservation JSON:\n${JSON.stringify(early.observation)}\n`;
  return {
    index,
    seed,
    observation: early.observation,
    futures: { early: early.future, late: late.future },
    answer,
    proof: early.proof,
    input,
  };
}

export function gradeResponse(raw, seed) {
  let action;
  try {
    action = JSON.parse(raw.trim());
  } catch {
    return { valid: false, reason: 'non-json-response' };
  }
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { valid: false, reason: 'response-not-object' };
  }
  if (
    Object.keys(action).some((field) => !['install_guard', 'hold_delivery_ids', 'pause_publisher'].includes(field)) ||
    (Object.hasOwn(action, 'install_guard') &&
      (!action.install_guard ||
        typeof action.install_guard !== 'object' ||
        Array.isArray(action.install_guard))) ||
    (Object.hasOwn(action, 'hold_delivery_ids') &&
      (!Array.isArray(action.hold_delivery_ids) ||
        !action.hold_delivery_ids.every((id) => typeof id === 'string'))) ||
    (Object.hasOwn(action, 'pause_publisher') && typeof action.pause_publisher !== 'boolean')
  ) {
    return { valid: false, reason: 'field-or-type-mismatch' };
  }
  const early = scorePolicy(seed, 'early', action);
  const late = scorePolicy(seed, 'late', action);
  return {
    valid: true,
    exact: early.exact && late.exact,
    futures: { early, late },
    action,
  };
}
