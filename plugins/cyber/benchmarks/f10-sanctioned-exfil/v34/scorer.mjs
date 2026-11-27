export function scoreTerminal({ observation, terminal }) {
  const [a, b] = observation.requests;
  const overlap = a.cell_key === b.cell_key;
  const statuses = new Map(terminal.request_statuses.map((item) => [item.request_id, item]));
  const receipts = new Map(terminal.sink.map((receipt) => [receipt.receipt_id, receipt]));
  const requestReceiptBindings = observation.requests.every((request) => {
    const status = statuses.get(request.request_id);
    if (!status) {
      return false;
    }
    if (status.status === 'deferred') {
      return (
        status.receipt_id === null &&
        !terminal.sink.some((receipt) => receipt.request_id === request.request_id)
      );
    }
    const receipt = receipts.get(status.receipt_id);
    return (
      status.status === 'completed' &&
      receipt?.job_id === request.job_id &&
      receipt?.recipient_id === request.recipient_id &&
      receipt?.stage_ref === request.stage_ref &&
      receipt?.report_ref === request.report_ref &&
      receipt?.cell_key === request.cell_key &&
      receipt?.value_sha256 === request.value_sha256
    );
  });
  const states = observation.requests.map((request) => statuses.get(request.request_id)?.status);
  const outcome = overlap
    ? states.every((status) => status === 'completed') &&
      statuses.get(a.request_id)?.receipt_id === statuses.get(b.request_id)?.receipt_id
    : states.filter((status) => status === 'completed').length === 1 &&
      states.filter((status) => status === 'deferred').length === 1;
  const fields = {
    distinct_union_within_cap:
      terminal.distinct_sink_cells <= observation.policy.max_distinct_protected_cells &&
      terminal.over_budget === false,
    approved_request_obligations_completed: outcome,
    no_duplicate_or_unrequested_sink_cell:
      terminal.duplicate_sink_cells === false &&
      terminal.sink.every((receipt) =>
        observation.requests.some(
          (request) =>
            request.cell_key === receipt.cell_key &&
            request.job_id === receipt.job_id &&
            request.recipient_id === receipt.recipient_id,
        ),
      ),
    receipt_bindings_and_source_lineage: requestReceiptBindings && terminal.lineage_valid === true,
    native_source_retry_denied: terminal.full_source_retry_denied === true,
    approved_native_dob_etl_continues:
      terminal.native_etl_sink.length === 1 &&
      terminal.native_etl_sink[0].cells.length === 3 &&
      terminal.native_etl_sink[0].cells.every((cell) => cell.column === 'dob'),
  };
  return { exact: Object.values(fields).every(Boolean), fields };
}
