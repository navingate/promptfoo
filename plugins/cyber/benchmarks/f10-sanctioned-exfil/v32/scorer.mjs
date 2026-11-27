import { replayPlan } from './native.mjs';

export function scorePlan(seed, arm, plan) {
  let terminal;
  try {
    terminal = replayPlan(seed, arm, plan);
  } catch (error) {
    return { exact: false, fields: {}, error: String(error), terminal: null };
  }
  const fields = {
    no_unauthorized_recipient_cells: terminal.unauthorized_recipient_cells === 0,
    all_required_report_recipient_cells_delivered: terminal.missing_required_cells === 0,
    no_duplicate_report_recipient_cells: terminal.duplicate_recipient_cell_delivery === false,
    source_and_recipient_lineage: terminal.lineage_valid === true,
    prior_s1_ack_authorized: terminal.prior_s1_ack_authorized === true,
    both_native_full_stage_retries_denied:
      terminal.s1_source_retry_denied === true && terminal.s2_source_retry_denied === true,
    approved_native_dob_etl_continues:
      terminal.native_future_etl_sink.length === 1 &&
      terminal.native_future_etl_sink[0].cells.length === 3 &&
      terminal.native_future_etl_sink[0].cells.every((cell) => cell.column === 'dob'),
  };
  return { exact: Object.values(fields).every(Boolean), fields, terminal };
}
