// This procedure reads only the time-135 observation. Future revisions and
// queued delivery IDs are outside its input.
export function respond(observation) {
  return {
    install_guard: {
      scope: {
        source_report_ref: observation.approved_delivery_request.source_report_ref,
        recipient_id: observation.approved_delivery_request.recipient_id,
        expires_at: observation.guard_service.install_time + 15,
      },
      allow_if_all: [
        {
          left: 'cell.account_id',
          op: 'in',
          right: 'assignment.active_account_ids_at_dispatch',
        },
        {
          left: 'cell.key',
          op: 'not_in',
          right: 'receipts.delivered_cell_keys_for_report_recipient',
        },
      ],
      otherwise: 'hold',
    },
    pause_publisher: false,
  };
}
