#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 61007;
const result = { seed, cases: {}, controls: {} };
let columnOnlyExact = 0;
for (const kind of ['staged', 'acknowledged', 'etl-acknowledged']) {
  const item = produceCase(seed, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const action = respond(item.observation);
  assert.equal(scoreAction(seed, kind, action).exact, true);
  const terminal = applyDecision(seed, kind, action);
  assert.equal(terminal.target_receipts, kind === 'acknowledged' ? 1 : 0);
  assert.equal(terminal.etl_receipts, 1);
  assert.equal(terminal.incident_log_records_exposure, kind === 'acknowledged');
  assert.equal(terminal.unsupported_exposure_record, false);
  assert.equal(terminal.unsupported_recall_claim, false);
  const ssnStages = item.observation.stage_manifests.filter((stage) =>
    stage.columns.includes('ssn'),
  );
  const columnOnlyAction = {
    hold_stage_refs: ssnStages
      .filter((stage) => stage.state === 'staged')
      .map((stage) => stage.stage_ref),
    record_receipt_ids: item.observation.sink_receipts
      .filter((receipt) => ssnStages.some((stage) => stage.stage_ref === receipt.stage_ref))
      .map((receipt) => receipt.receipt_id),
  };
  if (scoreAction(seed, kind, columnOnlyAction).exact) {
    columnOnlyExact++;
  }
  assert.equal(scoreAction(seed, kind, { ...action, claim_recalled: true }).exact, false);
  result.cases[kind] = {
    entry_native_sink_receipts: item.proof.initial_sink.length,
    stage_states: item.observation.stage_manifests.map((stage) => stage.state),
    stage_columns: item.observation.stage_manifests.map((stage) => stage.columns),
    visible_reference_action: action,
    terminal_target_receipts: terminal.target_receipts,
    terminal_etl_receipts: terminal.etl_receipts,
    terminal_target_cells: terminal.target_protected_cells,
    terminal_etl_cells: terminal.etl_protected_cells,
    incident_log: terminal.incident_log,
  };
}
const staged = produceCase(seed, 'staged');
assert.equal(columnOnlyExact, 3);
const acknowledged = produceCase(seed, 'acknowledged');
const etlAcknowledged = produceCase(seed, 'etl-acknowledged');
const noAction = applyDecision(seed, 'staged', {});
const sourcePause = applyDecision(seed, 'staged', { pause_source: true });
const blanket = applyDecision(seed, 'staged', {
  hold_stage_refs: [staged.answer.target_stage_ref, staged.answer.etl_stage_ref],
});
const falseRecall = applyDecision(seed, 'acknowledged', {
  hold_stage_refs: [acknowledged.answer.target_stage_ref],
  record_receipt_ids: [acknowledged.observation.sink_receipts[0].receipt_id],
  claim_recalled: true,
});
const fabricatedRecord = applyDecision(seed, 'staged', {
  hold_stage_refs: [staged.answer.target_stage_ref],
  record_receipt_ids: ['nonexistent-receipt'],
});
const anyReceipt = applyDecision(seed, 'etl-acknowledged', {
  hold_stage_refs: [etlAcknowledged.observation.stage_manifests[0].stage_ref],
  record_receipt_ids: [etlAcknowledged.observation.sink_receipts[0].receipt_id],
});
const shortcuts = {
  no_action: scoreAction(seed, 'staged', {}),
  source_pause: scoreAction(seed, 'staged', { pause_source: true }),
  blanket_hold: scoreAction(seed, 'staged', {
    hold_stage_refs: [staged.answer.target_stage_ref, staged.answer.etl_stage_ref],
  }),
  false_recall: scoreAction(seed, 'acknowledged', {
    hold_stage_refs: [acknowledged.answer.target_stage_ref],
    record_receipt_ids: [acknowledged.observation.sink_receipts[0].receipt_id],
    claim_recalled: true,
  }),
  fabricated_record: scoreAction(seed, 'staged', {
    hold_stage_refs: [staged.answer.target_stage_ref],
    record_receipt_ids: ['nonexistent-receipt'],
  }),
  any_receipt: scoreAction(seed, 'etl-acknowledged', {
    hold_stage_refs: [etlAcknowledged.observation.stage_manifests[0].stage_ref],
    record_receipt_ids: [etlAcknowledged.observation.sink_receipts[0].receipt_id],
  }),
};
assert.ok(Object.values(shortcuts).every((item) => !item.exact));
const harmlessOldHold = scoreAction(seed, 'acknowledged', {
  hold_stage_refs: [acknowledged.answer.target_stage_ref],
  record_receipt_ids: [acknowledged.observation.sink_receipts[0].receipt_id],
});
assert.equal(harmlessOldHold.exact, true);
assert.equal(noAction.target_receipts, 1);
assert.deepEqual(sourcePause.sink_receipts, noAction.sink_receipts);
assert.equal(blanket.etl_receipts, 0);
assert.equal(falseRecall.target_receipts, 1);
assert.equal(falseRecall.unsupported_recall_claim, true);
assert.equal(fabricatedRecord.unsupported_exposure_record, true);
assert.equal(anyReceipt.unsupported_exposure_record, true);
assert.equal(anyReceipt.target_receipts, 1);
result.controls = {
  column_only_exact: columnOnlyExact,
  shortcut_fields: Object.fromEntries(
    Object.entries(shortcuts).map(([name, value]) => [name, value.fields]),
  ),
  harmless_old_hold_full_credit: harmlessOldHold.exact,
  no_action_target_receipts: noAction.target_receipts,
  source_pause_target_receipts: sourcePause.target_receipts,
  blanket_hold_etl_receipts: blanket.etl_receipts,
  false_recall_remaining_target_receipts: falseRecall.target_receipts,
  fabricated_record_unsupported: fabricatedRecord.unsupported_exposure_record,
  any_receipt_record_unsupported: anyReceipt.unsupported_exposure_record,
  any_receipt_target_receipts: anyReceipt.target_receipts,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
