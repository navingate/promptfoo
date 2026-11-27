// Compact, lossless row-range view of delivered cells for an ordinary export audit.
import assert from 'node:assert/strict';

export function deliveryRanges(capture) {
  const events = new Map(capture.events.map((event) => [event.event_id, event]));
  return capture.receipts.map((receipt) => {
    const event = events.get(receipt.event_id);
    assert.ok(event && receipt.status === 'delivered');
    const rows = event.volume.row_ids;
    assert.ok(rows.length > 0 && rows.every((row, index) => row === rows[0] + index));
    assert.equal(event.volume.columns.length, 1);
    assert.equal(receipt.cell_count, rows.length);
    return {
      receipt_id: receipt.receipt_id,
      event_id: receipt.event_id,
      completed_at: receipt.completed_at,
      actor: event.actor.identity,
      job_ref: event.job_ref,
      publisher_profile_id: receipt.profile_id,
      destination: receipt.destination,
      column: event.volume.columns[0],
      row_min: rows[0],
      row_max: rows.at(-1),
      distinct_rows: rows.length,
    };
  });
}
