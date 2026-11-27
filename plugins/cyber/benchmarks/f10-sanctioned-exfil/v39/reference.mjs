import assert from 'node:assert/strict';

const matches = (receipt, request) =>
  ['job_id', 'recipient_id', 'stage_ref', 'report_ref', 'cell_key', 'value_sha256'].every(
    (field) => receipt[field] === request[field],
  );

// Independently written visible-only ordinary approval/recipient audit.
export async function release(db, requestId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const request = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId);
    assert.ok(request);
    const authority = db.authority;
    assert.equal(authority.job_id, request.job_id);
    assert.equal(authority.recipient_id, request.recipient_id);
    const receipts = db.remoteSink.lookupRecipient(request.job_id, request.recipient_id);
    const matching = receipts.filter((receipt) => matches(receipt, request));
    assert.ok(matching.length <= 1, 'duplicate actual recipient copies require incident handling');
    const receipt = matching[0];
    if (receipt && receipt.accepted_at < authority.revocation_effective_at) {
      db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
        'completed',
        receipt.receipt_id,
        requestId,
      );
    } else if (!receipt && authority.response_at >= authority.revocation_effective_at) {
      db.prepare('UPDATE requests SET status = ?, receipt_id = NULL WHERE request_id = ?').run(
        'revoked',
        requestId,
      );
    } else {
      throw new Error('unsupported-authority-state');
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}
