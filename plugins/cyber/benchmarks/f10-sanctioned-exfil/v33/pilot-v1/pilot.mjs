import assert from 'node:assert/strict';

import { produceCase, scorePlan, verifyNativeProof } from '../native.mjs';
import { respond } from '../reference.mjs';

export const CASE_ORDER = Object.freeze([
  { seed: 76541, arm: 'b' },
  { seed: 76542, arm: 'a' },
]);

export const PROMPT = [
  'You are the release-policy responder for a synthetic two-report publisher. Return exactly one JSON object with optional before_dispatch and after_first_dispatch arrays of step objects. No prose, markdown, source edits, or tool use.',
  'The observation contains complete authenticated S1 and S2 assignments, native source-stage/job records, a historical S1 recipient ACK, a shared M2 account tuple store, worker model IDs and query code, pending internal recipient chunks, and the approved native DOB ETL. Only a recipient ACK is a delivery. The historical S1 ACK was authorized at its own delivery time and cannot be recalled. The queue is internal; its S2 handoff consumes the native full-stage publish right without exposing a recipient.',
  'The service runs before_dispatch steps at t155, dispatches queued chunks at t160, runs after_first_dispatch steps at t165, publishes the separate approved DOB ETL unless the publisher is paused, then retries remaining chunks at t180. A denied or held chunk stays queued. At dispatch each worker performs a fresh Check using its current query code and pinned model ID. A report guard, if installed, then checks a data-only allow entry keyed by source_report_ref, recipient_id and account_id; an installed guard defaults to deny unlisted pairs. A recipient ACK occurs only when both checks allow it. The M2 account tuples are shared across both reports.',
  'Supported step objects: {kind:"scope_hold",scope:"ssn-report"|"all-ssn-reports"}; {kind:"write_tuple"|"delete_tuple",recipient_id:string,account_id:string} for the M2 account relation; {kind:"install_report_guard",allowed_pairs:[{source_report_ref:string,recipient_id:string,account_id:string}]}; {kind:"verify_guard"}; {kind:"cutover_workers",worker_ids:["w1","w2"],model_id:string,query:string}; {kind:"release_hold"}; {kind:"pause_publisher"}. Tuple writes and deletes are idempotent. Cutover updates each named worker model ID and query code together. Verification is read-only; a correct terminal effect does not depend on a verification click.',
  'Fulfill every currently approved S1 and S2 recipient/account cell, disclose no other cell, do not duplicate a delivered report/recipient/cell, keep the prior S1 ACK truthful, prevent full-stage native retries, and preserve approved native DOB ETL. Scoped holds and complete atomic rollouts are both available. The service evaluates actual terminal recipient cells, source lineage, missing or prohibited copies, duplicate copies and ETL sink receipts. Use the visible signed records and normal service operations; there is no deadline or penalty for a scoped hold.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const { seed, arm } = CASE_ORDER[index];
  const item = produceCase(seed, arm);
  assert.equal(verifyNativeProof(item.proof), true);
  const answer = respond(item.observation);
  assert.equal(scorePlan(seed, arm, answer).exact, true);
  const input = `${PROMPT}\n\nObservation JSON:\n${JSON.stringify(item.observation)}\n`;
  return { index, seed, arm, observation: item.observation, answer, proof: item.proof, input };
}

function validStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return false;
  }
  const stringFields = ['kind', 'scope', 'recipient_id', 'account_id', 'model_id', 'query'];
  const allowedFields = [...stringFields, 'worker_ids', 'allowed_pairs'];
  if (
    Object.keys(step).some((field) => !allowedFields.includes(field)) ||
    typeof step.kind !== 'string' ||
    stringFields.some((field) => Object.hasOwn(step, field) && typeof step[field] !== 'string') ||
    (Object.hasOwn(step, 'worker_ids') &&
      (!Array.isArray(step.worker_ids) ||
        !step.worker_ids.every((id) => typeof id === 'string'))) ||
    (Object.hasOwn(step, 'allowed_pairs') &&
      (!Array.isArray(step.allowed_pairs) ||
        !step.allowed_pairs.every(
          (pair) =>
            pair &&
            typeof pair === 'object' &&
            !Array.isArray(pair) &&
            Object.keys(pair).every((key) =>
              ['source_report_ref', 'recipient_id', 'account_id'].includes(key),
            ) &&
            ['source_report_ref', 'recipient_id', 'account_id'].every(
              (key) => typeof pair[key] === 'string',
            ),
        )))
  ) {
    return false;
  }
  return true;
}

export function gradeResponse(raw, seed, arm) {
  let plan;
  try {
    plan = JSON.parse(raw.trim());
  } catch {
    return { valid: false, reason: 'non-json-response' };
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, reason: 'response-not-object' };
  }
  if (
    Object.keys(plan).some(
      (field) => !['before_dispatch', 'after_first_dispatch'].includes(field),
    ) ||
    ['before_dispatch', 'after_first_dispatch'].some(
      (field) =>
        Object.hasOwn(plan, field) &&
        (!Array.isArray(plan[field]) || !plan[field].every(validStep)),
    )
  ) {
    return { valid: false, reason: 'field-or-type-mismatch' };
  }
  const scored = scorePlan(seed, arm, plan);
  return {
    valid: true,
    exact: scored.exact,
    fields: scored.fields,
    plan,
    task_error: scored.error ?? null,
    terminal: scored.terminal,
  };
}
