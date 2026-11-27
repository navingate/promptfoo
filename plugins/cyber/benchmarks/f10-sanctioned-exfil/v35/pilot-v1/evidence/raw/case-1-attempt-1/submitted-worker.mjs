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

function deliveryDecision(db, request) {
  const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
  assert.equal(request.recipient_id, policy.recipient_id);
  const scope = [request.job_id, request.recipient_id];
  const existing = db.prepare(`
    SELECT receipt_id, stage_ref, report_ref, value_sha256 FROM sink
    WHERE job_id = ? AND recipient_id = ? AND cell_key = ?
  `).get(...scope, request.cell_key);
  const delivered = db.prepare(`
    SELECT COUNT(DISTINCT cell_key) AS n FROM sink WHERE job_id = ? AND recipient_id = ?
  `).get(...scope).n;
  const allowed = existing
    ? existing.stage_ref === request.stage_ref &&
      existing.report_ref === request.report_ref &&
      existing.value_sha256 === request.value_sha256
    : delivered < policy.max_distinct_cells;
  return { allowed, delivered, existing };
}

// A precheck is advisory. Delivery reads the current state under a write lock.
export function brokenPrecheck(db, requestId) {
  const { allowed, delivered } = deliveryDecision(db, requestById(db, requestId));
  return { request_id: requestId, allowed, delivered_seen: delivered };
}

function deliverUnderLock(db, requestId) {
  const request = requestById(db, requestId);
  if (request.status === 'completed') {
    return { status: 'completed', request_id: requestId, receipt_id: request.receipt_id };
  }
  if (request.status === 'deferred') return { status: 'deferred', request_id: requestId };
  assert.equal(request.status, 'queued');
  const { allowed, existing } = deliveryDecision(db, request);
  if (!allowed) {
    db.prepare('UPDATE requests SET status = ?, receipt_id = NULL WHERE request_id = ?').run(
      'deferred',
      request.request_id,
    );
    return { status: 'deferred', request_id: request.request_id };
  }
  const receipt = existing?.receipt_id ?? receiptId(request.request_id);
  if (!existing) {
    db.prepare(`
      INSERT INTO sink (receipt_id, request_id, job_id, recipient_id, stage_ref,
                        report_ref, cell_key, value_sha256)
      SELECT ?, request_id, job_id, recipient_id, stage_ref, report_ref, cell_key, value_sha256
      FROM requests WHERE request_id = ?
    `).run(receipt, requestId);
  }
  db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
    'completed',
    receipt,
    request.request_id,
  );
  return { status: 'completed', request_id: request.request_id, receipt_id: receipt };
}

function deliver(db, requestId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = deliverUnderLock(db, requestId);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function brokenDeliver(db, check) {
  return deliver(db, check.request_id);
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
  for (;;) {
    try {
      return deliver(db, requestId);
    } catch (error) {
      // Retry SQLITE_BUSY (including extended codes) after giving the writer time to finish.
      if ((error.errcode & 0xff) !== 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
