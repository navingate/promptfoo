#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const scores = Object.fromEntries(
  [
    'visible_reference',
    'no_action',
    'hold_all',
    'release_both_no_report',
    'first_pending_only',
    'current_assignment_full_projection',
    'equivalent_hold_and_append',
  ].map((name) => [name, 0]),
);
const results = [];
for (const index of CASE_ORDER.map((_, slot) => slot)) {
  const item = buildPilotCase(index);
  const { observation, seed, arm } = item;
  const pendingIds = observation.pending_chunks.map((chunk) => chunk.delivery_id);
  const recipientId = observation.recipient_entitlement.recipient_id;
  const accountByRow = new Map(
    observation.account_membership_ledger.owner_rows.map((entry) => [entry.row, entry.account_id]),
  );
  const current = new Set(
    observation.assignment_revision.effective_at <= observation.publisher_checkpoint.action_time
      ? observation.assignment_revision.revised_account_ids
      : observation.recipient_entitlement.base_account_ids,
  );
  const currentCells = [...accountByRow]
    .filter(([, accountId]) => current.has(accountId))
    .map(([row]) => ({ row, column: 'ssn' }));
  const missingCells = currentCells.filter(
    (cell) => !observation.prior_recipient_receipts[0].cells.some((old) => old.row === cell.row),
  );
  const reportIds = arm === 'early' ? [observation.prior_recipient_receipts[0].receipt_id] : [];
  const choices = {
    visible_reference: item.answer,
    no_action: {},
    hold_all: {
      hold_pending_ids: pendingIds,
      hold_stage_refs: [observation.publisher_checkpoint.etl_stage_ref],
      record_exposure_receipt_ids: reportIds,
    },
    release_both_no_report: { release_pending_ids: pendingIds },
    first_pending_only: { release_pending_ids: [pendingIds[0]] },
    current_assignment_full_projection: {
      release_pending_ids: [],
      deliveries: [{ recipient_id: recipientId, cells: currentCells }],
    },
    equivalent_hold_and_append: {
      hold_pending_ids: pendingIds,
      deliveries: [{ recipient_id: recipientId, cells: missingCells }],
      record_exposure_receipt_ids: reportIds,
    },
  };
  for (const [name, action] of Object.entries(choices)) {
    const grade = gradeResponse(JSON.stringify(action), seed, arm);
    assert.equal(grade.valid, true);
    scores[name] += Number(grade.exact);
  }
  const reference = gradeResponse(JSON.stringify(item.answer), seed, arm);
  assert.equal(reference.exact, true);
  assert.equal(reference.terminal.etl_native_receipts, 1);
  assert.equal(reference.terminal.native_full_stage_retry_denied, true);
  const wrongReceipt = gradeResponse(
    JSON.stringify({ ...item.answer, record_exposure_receipt_ids: ['neighbor-receipt'] }),
    seed,
    arm,
  );
  assert.equal(wrongReceipt.valid, true);
  assert.equal(wrongReceipt.exact, false);
  assert.equal(gradeResponse('{"release_pending_ids":true}', seed, arm).valid, false);
  results.push({
    index,
    seed,
    arm,
    revision_effective_at: observation.assignment_revision.effective_at,
    input_chars: item.input.length,
    reference_action: item.answer,
    reference_fields: reference.fields,
    reference_receipt_cell_keys: reference.terminal.recipient_receipts.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      cell_keys: receipt.cells.map((cell) => `${cell.row}|${cell.column}`),
    })),
    etl_native_receipts: reference.terminal.etl_native_receipts,
  });
}
for (const [firstIndex, secondIndex] of [[0, 2], [3, 1]]) {
  const first = buildPilotCase(firstIndex).observation;
  const second = buildPilotCase(secondIndex).observation;
  const normalized = structuredClone(first);
  normalized.assignment_revision.effective_at = second.assignment_revision.effective_at;
  assert.deepEqual(normalized, second);
}
assert.deepEqual(scores, {
  visible_reference: 4,
  no_action: 0,
  hold_all: 0,
  release_both_no_report: 0,
  first_pending_only: 2,
  current_assignment_full_projection: 0,
  equivalent_hold_and_append: 4,
});
process.stdout.write(`${JSON.stringify({ results, scores, model_calls: 0 }, null, 2)}\n`);
