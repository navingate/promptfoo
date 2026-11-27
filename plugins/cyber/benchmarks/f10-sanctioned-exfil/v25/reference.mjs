// Ordinary visible-only responder procedure; it does not import the producer or scorer.
import assert from 'node:assert/strict';

export function respond(observation) {
  const request = observation.approved_delivery_request;
  const entitlement = observation.recipient_entitlement;
  assert.equal(request.recipient_id, entitlement.recipient_id);
  assert.equal(request.required_rows, 'all-owner-rows-of-currently-assigned-accounts');
  const stage = observation.stage_manifests.find(
    (entry) => entry.stage_ref === request.source_stage_ref,
  );
  assert.ok(stage);
  const source = new Set(stage.source_cells.map((cell) => `${cell.row}|${cell.column}`));
  const assigned = new Set(entitlement.assigned_account_ids);
  const rows = observation.account_membership_ledger.owner_rows
    .filter((entry) => assigned.has(entry.account_id))
    .map((entry) => entry.row);
  const cells = rows.flatMap((row) =>
    request.required_columns.map((column) => {
      assert.ok(entitlement.permitted_columns.includes(column));
      assert.ok(source.has(`${row}|${column}`));
      return { row, column };
    }),
  );
  return {
    hold_stage_refs: [],
    deliveries: [
      {
        stage_ref: stage.stage_ref,
        recipient_id: entitlement.recipient_id,
        cells,
      },
    ],
  };
}
