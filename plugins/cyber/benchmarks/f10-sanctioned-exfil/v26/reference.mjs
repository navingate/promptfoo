// This reference reads only serialized defender-visible evidence.
function assignedAt(observation, time) {
  const revision = observation.assignment_revision;
  return new Set(
    revision.effective_at <= time
      ? revision.revised_account_ids
      : observation.recipient_entitlement.base_account_ids,
  );
}

export function decideFromObservation(observation) {
  const current = assignedAt(observation, observation.publisher_checkpoint.action_time);
  const membership = new Map(
    observation.account_membership_ledger.owner_rows.map((entry) => [entry.row, entry.account_id]),
  );
  const priorKeys = new Set(
    observation.prior_recipient_receipts.flatMap((receipt) =>
      receipt.cells.map((cell) => `${cell.row}|${cell.column}`),
    ),
  );
  const incidentIds = observation.prior_recipient_receipts
    .filter((receipt) => {
      const authority = assignedAt(observation, receipt.delivered_at);
      return receipt.cells.some((cell) => !authority.has(membership.get(cell.row)));
    })
    .map((receipt) => receipt.receipt_id);
  const release = observation.pending_chunks.filter(
    (chunk) =>
      chunk.recipient_id === observation.recipient_entitlement.recipient_id &&
      chunk.cells.every(
        (cell) =>
          current.has(membership.get(cell.row)) &&
          !priorKeys.has(`${cell.row}|${cell.column}`),
      ),
  );
  const releaseIds = new Set(release.map((chunk) => chunk.delivery_id));
  return {
    release_pending_ids: [...releaseIds],
    hold_pending_ids: observation.pending_chunks
      .filter((chunk) => !releaseIds.has(chunk.delivery_id))
      .map((chunk) => chunk.delivery_id),
    record_exposure_receipt_ids: incidentIds,
  };
}
