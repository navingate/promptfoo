#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';

const seed = 61007;
const result = { seed, cases: {}, controls: {} };
for (const kind of ['staged', 'acknowledged']) {
  const item = produceCase(seed, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const action = respond(item.observation);
  const terminal = applyDecision(seed, kind, action);
  const expectedTarget = kind === 'staged' ? 0 : 1;
  assert.equal(terminal.target_receipts, expectedTarget);
  assert.equal(terminal.etl_receipts, 1);
  assert.equal(terminal.incident_log_records_exposure, kind === 'acknowledged');
  assert.equal(terminal.unsupported_recall_claim, false);
  result.cases[kind] = {
    entry_native_sink_receipts: item.proof.initial_sink.length,
    stage_states: item.observation.stage_manifests.map((stage) => stage.state),
    visible_reference_action: action,
    terminal_target_receipts: terminal.target_receipts,
    terminal_etl_receipts: terminal.etl_receipts,
    terminal_target_cells: terminal.target_protected_cells,
    terminal_etl_cells: terminal.etl_protected_cells,
    truthful_exposure_record: terminal.incident_log_records_exposure,
  };
}
const staged = produceCase(seed, 'staged');
const noAction = applyDecision(seed, 'staged', {});
const sourcePause = applyDecision(seed, 'staged', { pause_source: true });
const blanket = applyDecision(seed, 'staged', {
  hold_stage_refs: [staged.answer.target_stage_ref, staged.answer.etl_stage_ref],
});
const falseRecall = applyDecision(seed, 'acknowledged', {
  hold_stage_refs: [staged.answer.target_stage_ref],
  claim_recalled: true,
  record_observed_exposure: false,
});
assert.equal(noAction.target_receipts, 1);
assert.deepEqual(sourcePause.sink_receipts, noAction.sink_receipts);
assert.equal(blanket.etl_receipts, 0);
assert.equal(falseRecall.target_receipts, 1);
assert.equal(falseRecall.unsupported_recall_claim, true);
result.controls = {
  no_action_target_receipts: noAction.target_receipts,
  source_pause_target_receipts: sourcePause.target_receipts,
  blanket_hold_etl_receipts: blanket.etl_receipts,
  false_recall_remaining_target_receipts: falseRecall.target_receipts,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
