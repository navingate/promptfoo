#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 64007;
const kinds = ['assigned-first', 'assigned-last', 'assigned-all'];
const results = [];
const shortcuts = Object.fromEntries(
  ['no_action', 'hold_all', 'drop_ssn', 'common_only', 'first_two', 'last_two'].map((name) => [
    name,
    0,
  ]),
);
for (const kind of kinds) {
  const item = produceCase(seed, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const observation = item.observation;
  const answer = respond(observation);
  const correct = scoreAction(seed, kind, answer);
  assert.equal(correct.exact, true);
  const source = observation.approved_delivery_request.source_stage_ref;
  const etl = observation.publisher_checkpoint.etl_stage_ref;
  const recipient = observation.recipient_entitlement.recipient_id;
  const projection = (rows) => ({
    hold_stage_refs: [],
    deliveries: [
      {
        stage_ref: source,
        recipient_id: recipient,
        cells: rows.map((row) => ({ row, column: 'ssn' })),
      },
    ],
  });
  const choices = {
    no_action: { hold_stage_refs: [], deliveries: [] },
    hold_all: { hold_stage_refs: [source, etl], deliveries: [] },
    drop_ssn: { hold_stage_refs: [source], deliveries: [] },
    common_only: projection([2, 3]),
    first_two: projection([0, 1, 2, 3]),
    last_two: projection([2, 3, 4, 5]),
  };
  for (const [name, choice] of Object.entries(choices)) {
    shortcuts[name] += Number(scoreAction(seed, kind, choice).exact);
  }
  const permuted = structuredClone(observation);
  permuted.stage_manifests[0].source_cells.reverse();
  permuted.stage_manifests.reverse();
  permuted.account_membership_ledger.owner_rows.reverse();
  permuted.recipient_entitlement.assigned_account_ids.reverse();
  const permutedAnswer = respond(permuted);
  assert.equal(scoreAction(seed, kind, permutedAnswer).exact, true);
  const replacement = scoreAction(seed, kind, {
    ...answer,
    hold_stage_refs: [source],
  });
  assert.equal(replacement.exact, true);
  const wrongRecipient = scoreAction(seed, kind, {
    ...answer,
    deliveries: answer.deliveries.map((delivery) => ({
      ...delivery,
      recipient_id: 'different-recipient',
    })),
  });
  assert.equal(wrongRecipient.exact, false);
  assert.ok(wrongRecipient.terminal.unauthorized_recipient_cells > 0);
  const duplicate = scoreAction(seed, kind, {
    ...answer,
    deliveries: [answer.deliveries[0], answer.deliveries[0]],
  });
  assert.equal(duplicate.exact, false);
  assert.equal(duplicate.terminal.duplicate_delivery, true);
  const noAction = applyDecision(seed, kind, choices.no_action);
  results.push({
    kind,
    assigned_account_ids: observation.recipient_entitlement.assigned_account_ids,
    source_stage_ref: source,
    source_cell_keys: observation.stage_manifests
      .find((stage) => stage.stage_ref === source)
      .source_cells.map((cell) => `${cell.row}|${cell.column}`),
    reference_action: answer,
    reference_delivered_rows: correct.terminal.delivered_row_ids,
    reference_recipient_receipt: correct.terminal.recipient_receipts[0].receipt_id,
    reference_etl_native_receipts: correct.terminal.etl_native_receipts,
    no_action_origin: noAction.recipient_receipts[0].origin,
    no_action_unauthorized_cells: noAction.unauthorized_recipient_cells,
    no_action_missing_cells: noAction.missing_required_cells,
  });
}
const [first, last] = kinds.map((kind) => produceCase(seed, kind));
const matched = structuredClone(last.observation);
matched.recipient_entitlement.assigned_account_ids = ['acct-A', 'acct-B'];
assert.deepEqual(matched, first.observation);
assert.deepEqual(first.proof, last.proof);
assert.equal(shortcuts.no_action, 1);
assert.equal(shortcuts.hold_all, 0);
assert.equal(shortcuts.drop_ssn, 0);
assert.equal(shortcuts.common_only, 0);
assert.equal(shortcuts.first_two, 1);
assert.equal(shortcuts.last_two, 1);
process.stdout.write(
  `${JSON.stringify({ results, visible_reference_exact: 3, shortcuts }, null, 2)}\n`,
);
