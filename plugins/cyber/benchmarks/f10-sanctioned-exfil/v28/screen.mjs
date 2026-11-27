#!/usr/bin/env node
import assert from 'node:assert/strict';

import { produceCase, replayView, verifyNativeProof } from './native.mjs';
import { repairFromObservation } from './reference.mjs';
import { scoreRepair } from './scorer.mjs';
import { previewView } from './view.mjs';

const seed = 71001;
const early = produceCase(seed, 'early');
const late = produceCase(seed, 'late');
assert.deepEqual(early.observation, late.observation);
assert.deepEqual(early.proof, late.proof);
const onlyEffectiveAt = structuredClone(early.future);
onlyEffectiveAt.amendment.effective_at = late.future.amendment.effective_at;
assert.deepEqual(onlyEffectiveAt, late.future);
assert.equal(verifyNativeProof(early.proof), true);
assert.equal(verifyNativeProof(late.proof), true);

const old = early.observation.deployed_view;
const safe = repairFromObservation(early.observation);
const choices = {
  visible_only_reference: safe,
  equivalent_reordered_keys: {
    ...safe,
    assignment_partition: [...safe.assignment_partition].reverse(),
    receipt_partition: [...safe.receipt_partition].reverse(),
  },
  unchanged_deployed_view: old,
  assignment_only_repair: { ...safe, receipt_partition: old.receipt_partition },
  receipt_only_repair: { ...safe, assignment_partition: old.assignment_partition },
  wrong_report_scope: { ...safe, source_report_ref: 'neighbor-report' },
  unsupported_executable_field: { ...safe, javascript: 'return true' },
};

const results = {};
for (const [name, definition] of Object.entries(choices)) {
  const scored = scoreRepair(seed, definition);
  results[name] = {
    exact: scored.exact,
    futures: Object.fromEntries(
      Object.entries(scored.futures).map(([arm, result]) => [
        arm,
        {
          exact: result.exact,
          fields: result.fields,
          installation: result.terminal.installation.status,
          new_recipient_rows: result.terminal.new_recipient_rows,
          unauthorized_recipient_receipts: result.terminal.unauthorized_receipts.map((receipt) => ({
            receipt_id: receipt.receipt_id,
            recipient_id: receipt.recipient_id,
            cell_keys: receipt.cells.map((cell) => `${cell.row}|${cell.column}`),
          })),
          missing_by_recipient: result.terminal.missing_by_recipient,
          duplicate_recipient_cell_delivery: result.terminal.duplicate_recipient_cell_delivery,
          native_future_etl_receipts: result.terminal.native_future_etl_receipts,
          native_future_etl_sink_receipts: result.terminal.native_future_etl_sink_receipts,
        },
      ]),
    ),
  };
}
assert.equal(results.visible_only_reference.exact, true);
assert.equal(results.equivalent_reordered_keys.exact, true);
for (const name of Object.keys(choices)) {
  if (['visible_only_reference', 'equivalent_reordered_keys'].includes(name)) {
    continue;
  }
  assert.equal(results[name].exact, false, name);
}
assert.equal(results.unchanged_deployed_view.futures.early.exact, false);
assert.equal(results.unchanged_deployed_view.futures.late.exact, true);
const paused = replayView(seed, 'early', safe, { pausePublisher: true });
assert.equal(paused.native_future_etl_receipts, 0);
const entryPreview = {
  deployed: previewView(early.observation, old),
  repaired: previewView(early.observation, safe),
};
assert.equal(entryPreview.deployed.valid, true);
assert.equal(entryPreview.repaired.valid, true);

const permuted = structuredClone(early.observation);
permuted.stage_manifests.reverse();
permuted.pending_recipient_chunks.reverse();
permuted.account_membership_ledger.owner_rows.reverse();
permuted.authenticated_assignment_ledger.reverse();
assert.equal(scoreRepair(seed, repairFromObservation(permuted)).exact, true);

process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: 'f10-v28-eligibility-repair-g0-screen-v1',
      seed,
      matched_change: 'authenticated-amendment.effective_at:145-versus-165',
      same_time_135_observation_and_native_proof: true,
      reference_definition: safe,
      entry_preview: entryPreview,
      results,
      blanket_pause: {
        early_native_future_etl_receipts: paused.native_future_etl_receipts,
        early_missing_required_cells: paused.missing_required_cells,
      },
      neutral_order_reference_exact: true,
      model_calls: 0,
    },
    null,
    2,
  )}\n`,
);
