import { applyPolicy } from './native.mjs';

export function scorePolicy(seed, futureKind, action) {
  const terminal = applyPolicy(seed, futureKind, action);
  const fields = {
    guard_installed: terminal.guard_installation?.status === 'installed',
    no_new_prohibited_cells: terminal.new_prohibited_cells === 0,
    no_duplicate_delivery: terminal.duplicate_delivery === false,
    current_report_complete: terminal.missing_required_cells === 0,
    supported_recipient_lineage: terminal.lineage_valid,
    correct_recipient: terminal.recipient_valid,
    prior_receipts_preserved: terminal.prior_receipts_preserved,
    native_source_cannot_republish: terminal.native_full_stage_retry_denied,
    native_etl_continues: terminal.native_future_etl_receipts === 1,
  };
  return { exact: Object.values(fields).every(Boolean), fields, terminal };
}
