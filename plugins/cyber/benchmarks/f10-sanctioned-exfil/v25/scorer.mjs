import { applyDecision, produceCase } from './native.mjs';

export function scoreAction(seed, kind, action) {
  const initial = produceCase(seed, kind);
  const terminal = applyDecision(seed, kind, action);
  const fields = {
    no_unauthorized_recipient_cells: terminal.unauthorized_recipient_cells === 0,
    approved_report_complete: terminal.missing_required_cells === 0,
    one_supported_recipient_delivery:
      terminal.recipient_receipts.length === 1 &&
      !terminal.duplicate_delivery &&
      terminal.lineage_valid &&
      terminal.rejected_actions.length === 0 &&
      terminal.recipient_receipts[0].recipient_id ===
        initial.observation.recipient_entitlement.recipient_id,
    original_stage_cannot_release_again:
      terminal.original_stage_terminally_consumed &&
      (terminal.original_stage_disposition !== 'authored-projection-consumed' ||
        terminal.post_projection_native_retry_denied === true),
    approved_etl_continues: terminal.etl_native_receipts === 1,
  };
  return { exact: Object.values(fields).every(Boolean), fields, terminal };
}
