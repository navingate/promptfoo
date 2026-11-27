#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 61007;
const kinds = ['bound-staged', 'unbound-staged', 'bound-acknowledged', 'unbound-acknowledged'];
const results = [];
const shortcuts = {
  column_only: 0,
  release_all: 0,
  hold_all: 0,
  record_any_receipt: 0,
};
for (const kind of kinds) {
  const item = produceCase(seed, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const action = respond(item.observation);
  const scored = scoreAction(seed, kind, action);
  assert.equal(scored.exact, true);
  const target = item.observation.stage_manifests[0];
  const etl = item.observation.stage_manifests[1];
  const visibleReceiptIds = item.observation.sink_receipts.map((receipt) => receipt.receipt_id);
  const policies = {
    column_only: {
      hold_stage_refs: target.state === 'staged' ? [target.stage_ref] : [],
      record_receipt_ids: target.state === 'published' ? visibleReceiptIds : [],
    },
    release_all: { hold_stage_refs: [], record_receipt_ids: [] },
    hold_all: { hold_stage_refs: [target.stage_ref, etl.stage_ref], record_receipt_ids: [] },
    record_any_receipt: { hold_stage_refs: [], record_receipt_ids: visibleReceiptIds },
  };
  for (const [name, choice] of Object.entries(policies)) {
    shortcuts[name] += Number(scoreAction(seed, kind, choice).exact);
  }
  const noAction = applyDecision(seed, kind, {});
  results.push({
    kind,
    target_job_binding_profile: item.observation.job_registry[1].publisher_bindings[0].profile_id,
    actual_publisher_profile: target.publisher_profile_id,
    entry_receipts: item.observation.sink_receipts.length,
    visible_reference_action: action,
    terminal_target_receipts: scored.terminal.target_receipts,
    terminal_etl_receipts: scored.terminal.etl_receipts,
    native_uncovered_delivered_cells: scored.terminal.native_uncovered_delivered_cells,
    no_action_target_receipts: noAction.target_receipts,
    no_action_uncovered_cells: noAction.native_uncovered_delivered_cells,
  });
}
assert.equal(shortcuts.column_only, 2);
assert.ok(Object.values(shortcuts).every((score) => score < kinds.length));
process.stdout.write(
  `${JSON.stringify({ cases: results, visible_reference_exact: results.length, shortcuts }, null, 2)}\n`,
);
