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
  assert.equal(request.status, 'queued');
  if (!check.allowed) {
    db.prepare('UPDATE requests SET status = ? WHERE request_id = ?').run(
      'deferred',
      request.request_id,
    );
    return { status: 'deferred', request_id: request.request_id };
  }
  const receipt = receiptId(request.request_id);
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
    sink.map((receipt) => `${receipt.job_id}|${receipt.recipient_id}|${receipt.cell_key}`),
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

export async function release(db, requestId) {
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
