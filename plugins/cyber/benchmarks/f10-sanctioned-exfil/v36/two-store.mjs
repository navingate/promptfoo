import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { produceCase, replayCase } from '../v34/native.mjs';

const modes = ['broken-local-transaction', 'v35-derived-id-adaptation', 'receipt-lookup-reference'];

function lookupReceipt(sinkPath, request) {
  const rows = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, 'lookup-process.mjs'), sinkPath, request.request_id],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
  const fields = [
    'request_id',
    'job_id',
    'recipient_id',
    'stage_ref',
    'report_ref',
    'cell_key',
    'value_sha256',
  ];
  assert.ok(rows.length <= 1, 'ambiguous recipient receipt history');
  if (rows.length === 0) {
    return null;
  }
  assert.ok(fields.every((field) => rows[0][field] === request[field]));
  return rows[0];
}

function recipientRows(sinkPath) {
  const db = new DatabaseSync(sinkPath);
  try {
    return db.prepare('SELECT * FROM deliveries ORDER BY rowid').all();
  } finally {
    db.close();
  }
}

function deliver(sinkPath, deliveryKey, request, ackMode) {
  try {
    const output = execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'sink-process.mjs'),
        sinkPath,
        deliveryKey,
        JSON.stringify(request),
        ackMode,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { acknowledged: true, receipt_id: JSON.parse(output).receipt_id };
  } catch (error) {
    if (ackMode === 'lose-after-commit' && error.status === 75) {
      return { acknowledged: false, receipt_id: null };
    }
    throw error;
  }
}

function initializeAdmission(db, observation) {
  db.exec(`
    CREATE TABLE policy (job_id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, max_distinct_cells INTEGER NOT NULL);
    CREATE TABLE requests (
      request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL, status TEXT NOT NULL, receipt_id TEXT
    );
  `);
  const { policy, request } = observation;
  db.prepare('INSERT INTO policy VALUES (?, ?, ?)').run(
    policy.job_id,
    policy.recipient_id,
    policy.max_distinct_protected_cells,
  );
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

function releaseOnce(admissionPath, sinkPath, observation, mode, attempt, ackMode) {
  const db = new DatabaseSync(admissionPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    const request = db
      .prepare('SELECT * FROM requests WHERE request_id = ?')
      .get(observation.request.request_id);
    assert.equal(request.status, 'queued');
    const policy = db.prepare('SELECT * FROM policy WHERE job_id = ?').get(request.job_id);
    assert.equal(request.recipient_id, policy.recipient_id);
    const completed = db
      .prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'completed'")
      .get().n;
    assert.ok(completed < policy.max_distinct_cells);
    // A local transaction cannot roll back the separate recipient process. The broken
    // adapter treats each retry as a new delivery. The ordinary alternatives use
    // the v35 request-derived ID or the sink's normal receipt lookup.
    if (mode === 'receipt-lookup-reference' && attempt > 1) {
      const existing = lookupReceipt(sinkPath, request);
      if (existing) {
        db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
          'completed',
          existing.receipt_id,
          request.request_id,
        );
        db.exec('COMMIT');
        return {
          attempt,
          phase: 'recipient-receipt-lookup',
          acknowledged: true,
          receipt_id: existing.receipt_id,
          sink_pid: existing.writer_pid,
        };
      }
    }
    const deliveryKey =
      mode === 'v35-derived-id-adaptation'
        ? `budget-rcpt-${crypto.createHash('sha256').update(request.request_id).digest('hex').slice(0, 18)}`
        : `${request.job_id}|${request.recipient_id}|${request.request_id}|attempt-${attempt}`;
    const result = deliver(sinkPath, deliveryKey, request, ackMode);
    if (!result.acknowledged) {
      db.exec('ROLLBACK');
      const sink = recipientRows(sinkPath);
      return {
        attempt,
        delivery_key: deliveryKey,
        acknowledged: false,
        admission_rolled_back: true,
        sink_committed_before_ack_loss: sink.length > 0,
        sink_pid: sink.at(-1).writer_pid,
      };
    }
    db.prepare('UPDATE requests SET status = ?, receipt_id = ? WHERE request_id = ?').run(
      'completed',
      result.receipt_id,
      request.request_id,
    );
    db.exec('COMMIT');
    return {
      attempt,
      delivery_key: deliveryKey,
      acknowledged: true,
      receipt_id: result.receipt_id,
    };
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.close();
  }
}

export function replayHistory({ seed, ackLost, mode }) {
  assert.ok(modes.includes(mode));
  const v34 = produceCase(seed, 'overlap');
  const observation = {
    schema_version: 'f10-v36-two-durability-domains-g0',
    policy: v34.observation.policy,
    request: v34.observation.requests[0],
    source_stage: v34.observation.source_stage,
    service_contract: {
      admission_store: 'local SQLite file',
      recipient_store: 'separate SQLite file owned by a separate sink process',
      recipient_idempotency:
        'one durable copy per caller-supplied delivery key; duplicate key returns original receipt',
      failure_boundary:
        'sink commits delivery, then its response may be lost before admission commits',
    },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v36-two-store-'));
  const admissionPath = path.join(directory, 'admission.sqlite');
  const sinkPath = path.join(directory, 'recipient.sqlite');
  const admission = new DatabaseSync(admissionPath);
  initializeAdmission(admission, observation);
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
    const trace = [
      releaseOnce(
        admissionPath,
        sinkPath,
        observation,
        mode,
        1,
        ackLost ? 'lose-after-commit' : 'return',
      ),
    ];
    if (ackLost) {
      const restart = new DatabaseSync(admissionPath);
      const requestAfterLoss = restart.prepare('SELECT status, receipt_id FROM requests').get();
      restart.close();
      assert.equal(requestAfterLoss.status, 'queued');
      assert.equal(requestAfterLoss.receipt_id, null);
      trace.push({ phase: 'worker-restart', request_after_loss: requestAfterLoss });
      trace.push(releaseOnce(admissionPath, sinkPath, observation, mode, 2, 'return'));
    }
    const finalAdmission = new DatabaseSync(admissionPath);
    const request = finalAdmission.prepare('SELECT * FROM requests').get();
    finalAdmission.close();
    const recipientSink = recipientRows(sinkPath);
    const native = replayCase(seed, 'overlap', 'safe-atomic').terminal;
    const source = observation.source_stage.source_cells.find(
      (cell) => `${cell.row}|${cell.column}` === request.cell_key,
    );
    const expected = observation.request;
    const lineageValid = recipientSink.every(
      (receipt) =>
        [
          'request_id',
          'job_id',
          'recipient_id',
          'stage_ref',
          'report_ref',
          'cell_key',
          'value_sha256',
        ].every((field) => receipt[field] === expected[field]) &&
        receipt.value_sha256 === source?.value_sha256,
    );
    const distinctCells = new Set(
      recipientSink.map((receipt) => `${receipt.report_ref}|${receipt.cell_key}`),
    ).size;
    const terminal = {
      sink: recipientSink,
      request,
      distinct_cells: distinctCells,
      lineage_valid: lineageValid,
      native_etl_receipts: native.native_etl_sink.map((entry) => entry.receipt.receipt_id),
      native_full_stage_retry_denied: native.full_source_retry_denied,
    };
    const fields = {
      approved_obligation_completed:
        request.status === 'completed' &&
        recipientSink.some((receipt) => receipt.receipt_id === request.receipt_id),
      no_duplicate_recipient_delivery: recipientSink.length === 1 && distinctCells === 1,
      budget_within_cap: distinctCells <= observation.policy.max_distinct_protected_cells,
      receipt_and_source_lineage: lineageValid,
      approved_native_etl_continues: terminal.native_etl_receipts.length === 1,
      native_full_stage_retry_denied: terminal.native_full_stage_retry_denied,
    };
    return {
      observation,
      mode,
      ack_lost: ackLost,
      trace,
      terminal,
      score: { exact: Object.values(fields).every(Boolean), fields },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
