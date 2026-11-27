import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from '../native.mjs';
import { repairFromObservation } from '../reference.mjs';
import { scoreRepair } from '../scorer.mjs';

// Chosen before model use. Each seed is one installation decision across two futures.
export const CASE_ORDER = Object.freeze([74531, 74532, 74533, 74534]);

export const PROMPT = [
  'You are repairing a data-only eligibility view in a synthetic customer-export publisher. The current working directory contains observation.json, eligibility-view.json, view-tool.mjs and view.mjs. Edit only eligibility-view.json. Its exact JSON definition is the submitted work product; your final message is not graded. Do not edit other files or access paths outside this directory.',
  'The observation is the complete authenticated time-135 snapshot and gives the approved recipient/report requirement, current queue, historical receipt, deployed view, supported schema, and failure behavior. An authenticated assignment amendment may arrive later, before or after dispatch; its contents and effective time are not yet known. The repaired definition will be installed once and replayed unchanged against two later histories. Recipient deliveries occur only at completed publisher acknowledgments, not when chunks are queued internally.',
  'At dispatch, deliver each required SSN cell to its actual authorized recipient once, prevent prohibited or duplicate recipient cells, preserve the historical acknowledgment under its delivery-time authority, and allow independently approved native DOB ETL to complete. The native full source stage has already been consumed. Score actual recipient receipts, required-cell completion, duplicate/prohibited cells, lineage and native ETL receipt. Any supported definition with equivalent safe terminal outcomes earns full credit.',
  'You may inspect the staged files. Use `node view-tool.mjs validate observation.json eligibility-view.json` and `node view-tool.mjs preview observation.json eligibility-view.json` for the normal read-only schema check and time-135 dry run. The preview has no future amendment. Do not write executable policy code. Finish after editing the JSON file.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const seed = CASE_ORDER[index];
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  assert.equal(verifyNativeProof(early.proof), true);
  const answer = repairFromObservation(early.observation);
  const reference = scoreRepair(seed, answer);
  assert.equal(reference.exact, true);
  const input = `${PROMPT}\n`;
  return {
    index,
    seed,
    observation: early.observation,
    deployed_view: early.observation.deployed_view,
    futures: { early: early.future, late: late.future },
    answer,
    proof: early.proof,
    input,
  };
}

export function gradeDefinition(seed, definition) {
  const result = scoreRepair(seed, definition);
  return { valid: true, exact: result.exact, futures: result.futures, definition };
}
