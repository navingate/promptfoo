import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const receiptId = (requestId) =>
  `budget-rcpt-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 18)}`;

// Independently written ordinary repair. A local SQLite write transaction serializes the
// admission decision, durable sink append and request-to-receipt binding.
export function releaseAtomically(db, requestId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const request = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId);
    assert.ok(request);
    if (request.status === 'completed') {
      db.exec('COMMIT');
      return { status: 'completed', request_id: requestId, receipt_id: request.receipt_id };
    }
    assert.ok(['queued', 'deferred'].includes(request.status));
    const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
    assert.equal(request.recipient_id, policy.recipient_id);
    const existing = db
      .prepare(
        'SELECT receipt_id FROM sink WHERE job_id = ? AND recipient_id = ? AND cell_key = ? LIMIT 1',
      )
      .get(request.job_id, request.recipient_id, request.cell_key);
    if (existing) {
      db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
        'completed',
        existing.receipt_id,
        requestId,
      );
      db.exec('COMMIT');
      return { status: 'completed', request_id: requestId, receipt_id: existing.receipt_id };
    }
    const distinct = db
      .prepare(
        'SELECT COUNT(DISTINCT cell_key) AS n FROM sink WHERE job_id = ? AND recipient_id = ?',
      )
      .get(request.job_id, request.recipient_id).n;
    if (distinct >= policy.max_distinct_cells) {
      db.prepare('UPDATE requests SET status = ? WHERE request_id = ?').run('deferred', requestId);
      db.exec('COMMIT');
      return { status: 'deferred', request_id: requestId };
    }
    const receipt = receiptId(requestId);
    db.prepare('INSERT INTO sink VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      receipt,
      requestId,
      request.job_id,
      request.recipient_id,
      request.stage_ref,
      request.report_ref,
      request.cell_key,
      request.value_sha256,
    );
    db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
      'completed',
      receipt,
      requestId,
    );
    db.exec('COMMIT');
    return { status: 'completed', request_id: requestId, receipt_id: receipt };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
