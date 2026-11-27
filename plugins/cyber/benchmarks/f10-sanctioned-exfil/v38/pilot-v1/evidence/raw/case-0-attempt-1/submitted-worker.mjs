import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const receiptId = (requestId) =>
  `budget-rcpt-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 18)}`;

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 1000');
  return db;
}

export function initializeStore(db, observation) {
  db.exec(`
    CREATE TABLE policy (job_id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, max_distinct_cells INTEGER NOT NULL);
    CREATE TABLE requests (
      request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL, status TEXT NOT NULL, receipt_id TEXT
    );
    CREATE TABLE sink (
      receipt_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, job_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL, stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL,
      cell_key TEXT NOT NULL, value_sha256 TEXT NOT NULL
    );
  `);
  const policy = observation.policy;
  db.prepare('INSERT INTO policy VALUES (?, ?, ?)').run(
    policy.job_id,
    policy.recipient_id,
    policy.max_distinct_protected_cells,
  );
  const insert = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const request of observation.requests) {
    insert.run(
      request.request_id,
      request.job_id,
      request.recipient_id,
      request.stage_ref,
      request.report_ref,
      request.cell_key,
      request.value_sha256,
      'queued',
      null,
    );
  }
}

function requestById(db, requestId) {
  const request = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId);
  assert.ok(request, `unknown request ${requestId}`);
  return request;
}

// Deliberately flawed authored worker: eligibility is read separately from delivery, and it
// counts requests rather than the distinct delivered-cell union. Its result is stale on commit.
export function brokenPrecheck(db, requestId) {
  const request = requestById(db, requestId);
  const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
  assert.equal(request.recipient_id, policy.recipient_id);
  const delivered = db
    .prepare('SELECT COUNT(*) AS n FROM sink WHERE job_id = ?')
    .get(request.job_id).n;
  return {
    request_id: requestId,
    allowed: delivered + 1 <= policy.max_distinct_cells,
    delivered_seen: delivered,
  };
}

export function brokenDeliver(db, check) {
  const request = requestById(db, check.request_id);
  return finishRequest(db, request, check.allowed);
}

function finishRequest(db, request, allowed, existingReceipt) {
  assert.equal(request.status, 'queued');
  if (!allowed) {
    db.prepare('UPDATE requests SET status = ? WHERE request_id = ?').run(
      'deferred',
      request.request_id,
    );
    return { status: 'deferred', request_id: request.request_id };
  }
  const receipt = existingReceipt ?? receiptId(request.request_id);
  if (existingReceipt === undefined) {
    db.prepare('INSERT INTO sink VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      receipt,
      request.request_id,
      request.job_id,
      request.recipient_id,
      request.stage_ref,
      request.report_ref,
      request.cell_key,
      request.value_sha256,
    );
  }
  db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
    'completed',
    receipt,
    request.request_id,
  );
  return { status: 'completed', request_id: request.request_id, receipt_id: receipt };
}

export function inspectStore(db) {
  const sink = db.prepare('SELECT * FROM sink ORDER BY rowid').all();
  const requestStatuses = db
    .prepare('SELECT request_id, status, receipt_id FROM requests ORDER BY rowid')
    .all();
  const distinct = new Set(
    sink.map((r) => JSON.stringify([r.job_id, r.recipient_id, r.report_ref, r.cell_key])),
  );
  const max = db.prepare('SELECT max_distinct_cells FROM policy').get().max_distinct_cells;
  return {
    sink,
    request_statuses: requestStatuses,
    distinct_sink_cells: distinct.size,
    over_budget: distinct.size > max,
    duplicate_sink_cells: distinct.size !== sink.length,
  };
}

function releaseLocked(db, requestId) {
  const request = requestById(db, requestId);
  if (request.status === 'completed') {
    return { status: 'completed', request_id: requestId, receipt_id: request.receipt_id };
  }
  if (request.status === 'deferred') {
    return { status: 'deferred', request_id: requestId };
  }

  assert.equal(request.status, 'queued');
  const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
  assert.equal(request.recipient_id, policy.recipient_id);
  // A lost ACK can leave a committed delivery visible only at the recipient.
  const receipts = db.remoteSink.lookupRecipient(request.job_id, request.recipient_id);
  const cellId = (row) => JSON.stringify([row.report_ref, row.cell_key]);
  const delivered = new Set(receipts.map(cellId));
  let receipt = receipts.find((row) =>
    row.report_ref === request.report_ref && row.cell_key === request.cell_key &&
    row.stage_ref === request.stage_ref && row.value_sha256 === request.value_sha256
  );
  if (!receipt) {
    if (delivered.has(cellId(request)) || delivered.size >= policy.max_distinct_cells) {
      return finishRequest(db, request, false);
    }
    const ack = db.remoteSink.send(receiptId(requestId), request);
    receipt = { ...request, receipt_id: ack.receipt_id };
  }

  // Overlapping obligations share a receipt. Mirror its original sender once.
  assert.ok(receipt.receipt_id);
  db.prepare(`
    INSERT OR IGNORE INTO sink
      (receipt_id, request_id, job_id, recipient_id, stage_ref, report_ref, cell_key, value_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(receipt.receipt_id, receipt.request_id, receipt.job_id, receipt.recipient_id,
    receipt.stage_ref, receipt.report_ref, receipt.cell_key, receipt.value_sha256);
  return finishRequest(db, request, true, receipt.receipt_id);
}

export async function release(db, requestId) {
  for (;;) {
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = releaseLocked(db, requestId);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      // Extended SQLite result codes retain SQLITE_BUSY in the low byte.
      if ((error.errcode & 0xff) !== 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
