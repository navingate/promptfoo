import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function sameCell(receipt, request) {
  return (
    receipt.job_id === request.job_id &&
    receipt.recipient_id === request.recipient_id &&
    receipt.stage_ref === request.stage_ref &&
    receipt.report_ref === request.report_ref &&
    receipt.cell_key === request.cell_key &&
    receipt.value_sha256 === request.value_sha256
  );
}

export async function release(db, requestId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const request = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId);
    assert.ok(request);
    if (request.status !== 'queued') {
      db.exec('COMMIT');
      return { status: request.status, request_id: requestId, receipt_id: request.receipt_id };
    }
    const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
    assert.equal(request.recipient_id, policy.recipient_id);
    const recipientRows = db.remoteSink.lookupRecipient(request.job_id, request.recipient_id);
    const own = recipientRows.filter((receipt) => receipt.request_id === requestId);
    assert.ok(own.length <= 1 && own.every((receipt) => sameCell(receipt, request)));
    const same = recipientRows.filter((receipt) => sameCell(receipt, request));
    assert.ok(same.length <= 1, 'duplicate recipient receipt requires incident handling');
    let receipt = own[0] ?? same[0];
    let status;
    if (receipt) {
      status = 'completed';
    } else {
      const union = new Set(recipientRows.map((row) => `${row.report_ref}|${row.cell_key}`));
      if (union.size >= policy.max_distinct_cells) {
        status = 'deferred';
      } else {
        const stableKey = `budget-rcpt-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 18)}`;
        receipt = db.remoteSink.send(stableKey, request);
        status = 'completed';
      }
    }
    db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
      status,
      receipt?.receipt_id ?? null,
      requestId,
    );
    db.exec('COMMIT');
    return { status, request_id: requestId, receipt_id: receipt?.receipt_id ?? null };
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}
