// This repair procedure reads only the responder's time-135 observation.
// It never imports the private amendment schedules or terminal scorer.
export function repairFromObservation(observation) {
  const request = observation.approved_delivery_request;
  const supported = new Set(observation.eligibility_view_contract.supported_partition_keys);
  if (!supported.has('source_report_ref') || !supported.has('recipient_id')) {
    throw new Error('recipient-scoped eligibility lookup is unavailable');
  }
  if (!request.recipients?.r1 || !request.recipients?.r2) {
    throw new Error('the recipient identities must be visible');
  }
  return {
    source_report_ref: request.source_report_ref,
    assignment_partition: ['source_report_ref', 'recipient_id'],
    receipt_partition: ['source_report_ref', 'recipient_id'],
    as_of: 'dispatch_time',
    otherwise: 'hold',
  };
}
