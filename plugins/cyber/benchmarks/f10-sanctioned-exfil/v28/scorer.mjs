import { replayView } from './native.mjs';

function scoreFuture(seed, arm, definition) {
  const terminal = replayView(seed, arm, definition);
  const fields = {
    no_new_unauthorized_recipient_cells: terminal.new_unauthorized_cells === 0,
    current_recipient_reports_complete: terminal.missing_required_cells === 0,
    no_duplicate_recipient_cell_delivery: terminal.duplicate_recipient_cell_delivery === false,
    source_recipient_lineage: terminal.lineage_valid,
    correct_recipients: terminal.recipient_valid,
    prior_receipt_preserved: terminal.prior_receipt_preserved,
    historical_ack_authorized_at_delivery: terminal.historical_r1_a_authorized,
    native_full_source_stage_cannot_republish: terminal.native_source_retry_denied,
    approved_native_dob_etl_continues: terminal.native_future_etl_receipts === 1,
  };
  return { exact: Object.values(fields).every(Boolean), fields, terminal };
}

export function scoreRepair(seed, definition) {
  const early = scoreFuture(seed, 'early', definition);
  const late = scoreFuture(seed, 'late', definition);
  return { exact: early.exact && late.exact, futures: { early, late } };
}
