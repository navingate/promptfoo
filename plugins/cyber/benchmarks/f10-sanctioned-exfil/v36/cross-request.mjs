import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { produceCase, replayCase } from '../v34/native.mjs';

const key = (requestId) =>
  `budget-rcpt-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 18)}`;

function send(sinkPath, request, loseAck) {
  try {
    const output = execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'sink-process.mjs'),
        sinkPath,
        key(request.request_id),
        JSON.stringify(request),
        loseAck ? 'lose-after-commit' : 'return',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { acknowledged: true, receipt_id: JSON.parse(output).receipt_id };
  } catch (error) {
    if (loseAck && error.status === 75) {
      return { acknowledged: false, receipt_id: null };
    }
    throw error;
  }
}

function lookup(sinkPath, jobId, recipientId) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'lookup-process.mjs'),
        sinkPath,
        'recipient',
        jobId,
        recipientId,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}

function initAdmission(db, observation) {
  db.exec(`
    CREATE TABLE policy (job_id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, max_distinct_cells INTEGER NOT NULL);
    CREATE TABLE requests (
      request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL, status TEXT NOT NULL, receipt_id TEXT
    );
    CREATE TABLE sink_shadow (
      receipt_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL
    );
  `);
  const { policy } = observation;
  db.prepare('INSERT INTO policy VALUES (?, ?, ?)').run(
    policy.job_id,
    policy.recipient_id,
    policy.max_distinct_protected_cells,
  );
  addRequest(db, observation.requests[0]);
}

function addRequest(db, request) {
  db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
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

function complete(db, requestId, receiptId) {
  db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
    'completed',
    receiptId,
    requestId,
  );
  return { status: 'completed', request_id: requestId, receipt_id: receiptId };
}

function defer(db, requestId) {
  db.prepare('UPDATE requests SET status = ?, receipt_id = NULL WHERE request_id = ?').run(
    'deferred',
    requestId,
  );
  return { status: 'deferred', request_id: requestId };
}

function matchesCell(receipt, request) {
  return (
    receipt.job_id === request.job_id &&
    receipt.recipient_id === request.recipient_id &&
    receipt.stage_ref === request.stage_ref &&
    receipt.report_ref === request.report_ref &&
    receipt.cell_key === request.cell_key &&
    receipt.value_sha256 === request.value_sha256
  );
}

function baselineRelease(db, sinkPath, request) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT * FROM sink_shadow WHERE job_id = ? AND recipient_id = ? AND cell_key = ?')
      .get(request.job_id, request.recipient_id, request.cell_key);
    if (existing) {
      const result = matchesCell(existing, request)
        ? complete(db, request.request_id, existing.receipt_id)
        : defer(db, request.request_id);
      db.exec('COMMIT');
      return result;
    }
    const count = db
      .prepare(
        'SELECT COUNT(DISTINCT cell_key) AS n FROM sink_shadow WHERE job_id = ? AND recipient_id = ?',
      )
      .get(request.job_id, request.recipient_id).n;
    const cap = db.prepare('SELECT max_distinct_cells FROM policy').get().max_distinct_cells;
    if (count >= cap) {
      const result = defer(db, request.request_id);
      db.exec('COMMIT');
      return result;
    }
    const delivery = send(sinkPath, request, false);
    db.prepare('INSERT INTO sink_shadow VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      delivery.receipt_id,
      request.job_id,
      request.recipient_id,
      request.stage_ref,
      request.report_ref,
      request.cell_key,
      request.value_sha256,
    );
    const result = complete(db, request.request_id, delivery.receipt_id);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}

function reconcileRelease(db, sinkPath, request) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const actual = lookup(sinkPath, request.job_id, request.recipient_id);
    const own = actual.filter((receipt) => receipt.request_id === request.request_id);
    assert.ok(own.length <= 1 && own.every((receipt) => matchesCell(receipt, request)));
    const sameCell = actual.filter((receipt) => matchesCell(receipt, request));
    assert.ok(sameCell.length <= 1, 'duplicate recipient history requires incident response');
    let result;
    if (own.length === 1) {
      result = complete(db, request.request_id, own[0].receipt_id);
    } else if (sameCell.length === 1) {
      result = complete(db, request.request_id, sameCell[0].receipt_id);
    } else {
      const cap = db.prepare('SELECT max_distinct_cells FROM policy').get().max_distinct_cells;
      const union = new Set(actual.map((receipt) => `${receipt.report_ref}|${receipt.cell_key}`));
      if (union.size >= cap) {
        result = defer(db, request.request_id);
      } else {
        const delivered = send(sinkPath, request, false);
        result = complete(db, request.request_id, delivered.receipt_id);
      }
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}

function score(observation, terminal) {
  const [a, b] = observation.requests;
  const overlap = a.cell_key === b.cell_key;
  const states = new Map(terminal.requests.map((request) => [request.request_id, request]));
  const actual = terminal.sink;
  const receiptById = new Map(actual.map((receipt) => [receipt.receipt_id, receipt]));
  const expected = overlap
    ? states.get(a.request_id)?.status === 'completed' &&
      states.get(b.request_id)?.status === 'completed' &&
      states.get(a.request_id)?.receipt_id === states.get(b.request_id)?.receipt_id
    : states.get(a.request_id)?.status === 'completed' &&
      states.get(b.request_id)?.status === 'deferred';
  const fields = {
    distinct_union_within_cap:
      terminal.distinct_cells <= observation.policy.max_distinct_protected_cells,
    no_duplicate_recipient_delivery: actual.length === 1,
    approved_obligations: expected,
    receipt_bindings_and_source_lineage:
      observation.requests.every((request) => {
        const state = states.get(request.request_id);
        if (state.status === 'deferred') {
          return (
            state.receipt_id === null &&
            !actual.some((receipt) => receipt.request_id === request.request_id)
          );
        }
        const receipt = receiptById.get(state.receipt_id);
        return state.status === 'completed' && receipt && matchesCell(receipt, request);
      }) && terminal.lineage_valid,
    native_dob_etl_continues: terminal.native_etl_receipts.length === 1,
    native_full_stage_retry_denied: terminal.native_full_stage_retry_denied,
  };
  return { exact: Object.values(fields).every(Boolean), fields };
}

export function replayCrossRequest({ seed, kind, mode }) {
  assert.ok(['overlap', 'distinct'].includes(kind));
  assert.ok(['v35-request-key-adaptation', 'ordinary-recipient-reconcile'].includes(mode));
  const v34 = produceCase(seed, kind);
  const observation = {
    schema_version: 'f10-v36-cross-request-lost-ack-g0',
    policy: v34.observation.policy,
    source_stage: v34.observation.source_stage,
    requests: v34.observation.requests,
    recipient_service:
      'separate durable process; same caller key is idempotent; authenticated receipt lookup available',
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v36-cross-'));
  const admissionPath = path.join(directory, 'admission.sqlite');
  const sinkPath = path.join(directory, 'recipient.sqlite');
  const admission = new DatabaseSync(admissionPath);
  initAdmission(admission, observation);
  admission.close();
  const sink = new DatabaseSync(sinkPath);
  sink.exec(`CREATE TABLE deliveries (
    receipt_id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
    stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
    value_sha256 TEXT NOT NULL, writer_pid INTEGER NOT NULL
  )`);
  sink.close();
  try {
    const [a, b] = observation.requests;
    const first = send(sinkPath, a, true);
    assert.equal(first.acknowledged, false);
    const accepted = lookup(sinkPath, a.job_id, a.recipient_id);
    assert.equal(accepted.length, 1);
    const trace = [
      {
        phase: 'A-ACK-lost',
        recipient_committed_before_ack_loss: true,
        receipt_id: accepted[0].receipt_id,
        sink_pid: accepted[0].writer_pid,
      },
    ];
    const db = new DatabaseSync(admissionPath);
    addRequest(db, b);
    const release = mode === 'ordinary-recipient-reconcile' ? reconcileRelease : baselineRelease;
    trace.push({ phase: 'new-B-arrives-and-releases', result: release(db, sinkPath, b) });
    trace.push({ phase: 'A-retries-after-restart', result: release(db, sinkPath, a) });
    const requests = db.prepare('SELECT * FROM requests ORDER BY rowid').all();
    db.close();
    const actual = lookup(sinkPath, a.job_id, a.recipient_id);
    const sourceByCell = new Map(
      observation.source_stage.source_cells.map((cell) => [
        `${cell.row}|${cell.column}`,
        cell.value_sha256,
      ]),
    );
    const native = replayCase(seed, kind, 'safe-atomic').terminal;
    const terminal = {
      sink: actual,
      requests,
      distinct_cells: new Set(actual.map((receipt) => `${receipt.report_ref}|${receipt.cell_key}`))
        .size,
      lineage_valid: actual.every(
        (receipt) =>
          receipt.job_id === a.job_id &&
          receipt.recipient_id === a.recipient_id &&
          receipt.stage_ref === a.stage_ref &&
          receipt.report_ref === a.report_ref &&
          receipt.value_sha256 === sourceByCell.get(receipt.cell_key),
      ),
      native_etl_receipts: native.native_etl_sink.map((entry) => entry.receipt.receipt_id),
      native_full_stage_retry_denied: native.full_source_retry_denied,
    };
    return { observation, kind, mode, trace, terminal, score: score(observation, terminal) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
