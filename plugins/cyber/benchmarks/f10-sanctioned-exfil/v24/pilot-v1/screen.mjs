#!/usr/bin/env node
import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from '../native.mjs';
import { scoreAction } from '../scorer.mjs';
import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const expected = [
  { entry: 1, target: 1, etl: 1, uncovered: 0, record: false },
  { entry: 0, target: 0, etl: 1, uncovered: 0, record: false },
  { entry: 1, target: 1, etl: 1, uncovered: 3, record: true },
  { entry: 0, target: 1, etl: 1, uncovered: 0, record: false },
];
for (const [index, { seed, kind }] of CASE_ORDER.entries()) {
  const item = buildPilotCase(index);
  assert.equal(item.seed, seed);
  assert.equal(item.kind, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const serialized = JSON.parse(item.input.split('Observation JSON:\n')[1]);
  assert.deepEqual(serialized, item.observation);
  assert.deepEqual(serialized, produceCase(seed, kind).observation);
  const grade = gradeResponse(JSON.stringify(item.answer), seed, kind);
  assert.equal(grade.valid, true);
  assert.equal(grade.exact, true);
  assert.equal(serialized.sink_receipts.length, expected[index].entry);
  assert.equal(grade.terminal.target_receipts, expected[index].target);
  assert.equal(grade.terminal.etl_receipts, expected[index].etl);
  assert.equal(grade.terminal.native_uncovered_delivered_cells, expected[index].uncovered);
  assert.equal(grade.terminal.incident_log_records_exposure, expected[index].record);
  for (const wrong of [
    { ...item.answer, claim_recalled: true },
    { ...item.answer, record_receipt_ids: ['nonexistent-receipt'] },
  ]) {
    const result = gradeResponse(JSON.stringify(wrong), seed, kind);
    assert.equal(result.valid, true);
    assert.equal(result.exact, false);
  }
}

function pairedBindingCheck(seed, suffix) {
  const bound = produceCase(seed, `bound-${suffix}`).observation;
  const unbound = produceCase(seed, `unbound-${suffix}`).observation;
  const changed = structuredClone(unbound);
  const targetStage = changed.stage_manifests.find(
    (stage) =>
      stage.columns.includes('ssn') && stage.actor !== changed.job_registry[0].actor_binding[0],
  );
  assert.ok(targetStage);
  const job = changed.job_registry.find((entry) => entry.job_id === targetStage.job_ref);
  const boundJob = bound.job_registry.find((entry) => entry.job_id === targetStage.job_ref);
  assert.ok(job && boundJob);
  assert.notEqual(job.publisher_bindings[0].profile_id, boundJob.publisher_bindings[0].profile_id);
  job.publisher_bindings[0].profile_id = boundJob.publisher_bindings[0].profile_id;
  assert.deepEqual(changed, bound);
}
pairedBindingCheck(63001, 'staged');
pairedBindingCheck(63002, 'acknowledged');

const noAction = scoreAction(63001, 'unbound-staged', {
  hold_stage_refs: [],
  record_receipt_ids: [],
});
assert.equal(noAction.exact, false);
assert.equal(noAction.terminal.target_receipts, 1);
assert.equal(noAction.terminal.etl_receipts, 1);
assert.equal(noAction.terminal.native_uncovered_delivered_cells, 3);
const harmlessOldHold = scoreAction(63002, 'unbound-acknowledged', {
  ...buildPilotCase(2).answer,
  hold_stage_refs: [produceCase(63002, 'unbound-acknowledged').answer.target_stage_ref],
});
assert.equal(harmlessOldHold.exact, true);
process.stdout.write(
  `${JSON.stringify({ cases: 4, reference_exact: 4, matched_binding_pairs: 2, valid_wrong_action_controls: 8, no_action_unbound_staged_uncovered: 3, harmless_old_hold_exact: true, order: CASE_ORDER })}\n`,
);
