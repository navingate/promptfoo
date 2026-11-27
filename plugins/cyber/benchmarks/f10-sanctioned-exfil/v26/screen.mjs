#!/usr/bin/env node
import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from './native.mjs';
import { decideFromObservation } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 67001;
const arms = ['early', 'late'];
const scores = Object.fromEntries(
  [
    'visible_reference',
    'no_action',
    'blanket_hold',
    'first_pending_only',
    'both_pending_no_incident',
    'current_assignment_full_projection',
    'truthful_incident_both_pending',
  ].map((name) => [name, 0]),
);
const results = [];
for (const arm of arms) {
  const item = produceCase(seed, arm);
  assert.equal(verifyNativeProof(item.proof), true);
  const observation = item.observation;
  const reference = decideFromObservation(observation);
  const accountByRow = new Map(
    observation.account_membership_ledger.owner_rows.map((entry) => [entry.row, entry.account_id]),
  );
  const current = new Set(item.answer.current_account_ids);
  const requestedRows = [...accountByRow]
    .filter(([, accountId]) => current.has(accountId))
    .map(([row]) => row);
  const pendingIds = observation.pending_chunks.map((chunk) => chunk.delivery_id);
  const receiptId = observation.prior_recipient_receipts[0].receipt_id;
  const choices = {
    visible_reference: reference,
    no_action: {},
    blanket_hold: {
      hold_pending_ids: pendingIds,
      hold_stage_refs: [observation.publisher_checkpoint.etl_stage_ref],
      record_exposure_receipt_ids: arm === 'early' ? [receiptId] : [],
    },
    first_pending_only: {
      release_pending_ids: [pendingIds[0]],
      record_exposure_receipt_ids: [],
    },
    both_pending_no_incident: {
      release_pending_ids: pendingIds,
      record_exposure_receipt_ids: [],
    },
    current_assignment_full_projection: {
      release_pending_ids: [],
      deliveries: [{
        recipient_id: observation.recipient_entitlement.recipient_id,
        cells: requestedRows.map((row) => ({ row, column: 'ssn' })),
      }],
      record_exposure_receipt_ids: [],
    },
    truthful_incident_both_pending: {
      release_pending_ids: pendingIds,
      record_exposure_receipt_ids: arm === 'early' ? [receiptId] : [],
    },
  };
  for (const [name, action] of Object.entries(choices)) {
    scores[name] += Number(scoreAction(seed, arm, action).exact);
  }
  const scored = scoreAction(seed, arm, reference);
  assert.equal(scored.exact, true, JSON.stringify(scored.fields));
  assert.equal(scored.terminal.native_full_stage_retry_denied, true);
  assert.equal(scored.terminal.etl_native_receipts, 1);
  const permuted = structuredClone(observation);
  permuted.stage_manifests.reverse();
  permuted.account_membership_ledger.owner_rows.reverse();
  permuted.pending_chunks.reverse();
  for (const stage of permuted.stage_manifests) {
    stage.source_cells.reverse();
  }
  assert.equal(scoreAction(seed, arm, decideFromObservation(permuted)).exact, true);
  const falseRecord = scoreAction(seed, arm, {
    ...reference,
    record_exposure_receipt_ids: arm === 'early' ? [] : [receiptId],
  });
  assert.equal(falseRecord.fields.truthful_historical_incident, false);
  const wrongReceipt = scoreAction(seed, arm, {
    ...reference,
    record_exposure_receipt_ids: ['prcpt-from-neighbor'],
  });
  assert.equal(wrongReceipt.fields.truthful_historical_incident, false);
  results.push({
    arm,
    revision_effective_at: observation.assignment_revision.effective_at,
    action_time: observation.publisher_checkpoint.action_time,
    prior_ack_time: observation.prior_recipient_receipts[0].delivered_at,
    prior_receipt_id: receiptId,
    prior_ack_unauthorized: item.answer.prior_ack_unauthorized,
    current_account_ids: item.answer.current_account_ids,
    reference,
    recipient_receipts: scored.terminal.recipient_receipts.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      delivery_id: receipt.delivery_id,
      origin: receipt.origin,
      recipient_id: receipt.recipient_id,
      delivered_at: receipt.delivered_at,
      cell_keys: receipt.cells.map((cell) => `${cell.row}|${cell.column}`),
      lineage_valid: scored.terminal.lineage_valid,
    })),
    pending_chunk_outcomes: scored.terminal.pending_chunk_outcomes,
    incident_records: scored.terminal.incident_records,
    missing_required_cells: scored.terminal.missing_required_cells,
    new_prohibited_cells: scored.terminal.new_prohibited_cells,
    duplicate_delivery: scored.terminal.duplicate_delivery,
    native_full_stage_retry_denied: scored.terminal.native_full_stage_retry_denied,
    etl_native_receipts: scored.terminal.etl_native_receipts,
  });
}
const early = produceCase(seed, 'early').observation;
const late = produceCase(seed, 'late').observation;
const normalized = structuredClone(early);
normalized.assignment_revision.effective_at = 140;
assert.deepEqual(normalized, late);
assert.deepEqual(scores, {
  visible_reference: 2,
  no_action: 0,
  blanket_hold: 0,
  first_pending_only: 1,
  both_pending_no_incident: 0,
  current_assignment_full_projection: 0,
  truthful_incident_both_pending: 1,
});
process.stdout.write(`${JSON.stringify({ results, scores, model_calls: 0 }, null, 2)}\n`);
