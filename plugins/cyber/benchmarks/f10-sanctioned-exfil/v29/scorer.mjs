import { replayPolicy } from './native.mjs';

export function scorePolicy(seed, arm, policy) {
  const terminal = replayPolicy(seed, arm, policy);
  const etl = terminal.native_etl_proof;
  const fields = {
    no_prohibited_v2_recipient_cells: terminal.unauthorized_v2_cells === 0,
    required_v2_work_complete: terminal.missing_required_v2_cells === 0,
    no_duplicate_v2_recipient_cell: terminal.duplicate_v2_recipient_cell === false,
    exact_version_and_source_lineage: terminal.lineage_valid,
    historical_v1_ack_preserved: terminal.old_v1_receipt_preserved,
    approved_native_dob_etl_continues:
      terminal.native_etl_receipts.length === 1 &&
      etl?.receipt.status === 'delivered' &&
      etl.receipt.destination.startsWith('approved://') &&
      etl.receipt.cell_count === etl.cells.length &&
      etl.cells.length === 3 &&
      etl.cells.every((cell) => cell.column === 'dob'),
  };
  return { exact: Object.values(fields).every(Boolean), fields, terminal };
}
