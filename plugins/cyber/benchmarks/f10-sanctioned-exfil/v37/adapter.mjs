import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { produceCase, replayCase } from '../v34/native.mjs';
import * as v35First from '../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs';
import * as v35Second from '../v35/pilot-v1/evidence/raw/case-1-attempt-1/submitted-worker.mjs';
import * as ordinary from './reference-worker.mjs';

const workers = { 'v35-0': v35First, 'v35-1': v35Second, 'ordinary-reference': ordinary };
const sinkScript = path.resolve(import.meta.dirname, '../v36/sink-process.mjs');
const lookupScript = path.resolve(import.meta.dirname, '../v36/lookup-process.mjs');

function sinkRows(sinkPath, jobId, recipientId) {
  return JSON.parse(
    execFileSync(process.execPath, [lookupScript, sinkPath, 'recipient', jobId, recipientId], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function remoteClient(sinkPath) {
  let dropNextAck = true;
  return {
    send(deliveryKey, request) {
      const loseAck = dropNextAck;
      dropNextAck = false;
      const output = execFileSync(
        process.execPath,
        [
          sinkScript,
          sinkPath,
          deliveryKey,
          JSON.stringify(request),
          loseAck ? 'lose-after-commit' : 'return',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return { receipt_id: JSON.parse(output).receipt_id };
    },
    lookupRecipient(jobId, recipientId) {
      return sinkRows(sinkPath, jobId, recipientId);
    },
  };
}

function workerDb(db, remoteSink) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'remoteSink') {
        return remoteSink;
      }
      if (property === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          if (!/\bINSERT\s+INTO\s+sink\b/i.test(sql)) {
            return statement;
          }
          return {
            run(...args) {
              const receiptId = args[0];
              const request =
                args.length === 2
                  ? target.prepare('SELECT * FROM requests WHERE request_id = ?').get(args[1])
                  : Object.fromEntries(
                      [
                        'request_id',
                        'job_id',
                        'recipient_id',
                        'stage_ref',
                        'report_ref',
                        'cell_key',
                        'value_sha256',
                      ].map((field, index) => [field, args[index + 1]]),
                    );
              assert.ok(request);
              remoteSink.send(receiptId, request);
              return statement.run(...args);
            },
          };
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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

function grade(observation, terminal) {
  const [a, b] = observation.requests;
  const overlap = a.cell_key === b.cell_key;
  const [aStatus, bStatus] = terminal.requests;
  const recipient = terminal.remote_sink;
  const receipts = new Map(
    recipient.flatMap((row) => [
      [row.receipt_id, row],
      [row.delivery_key, row],
    ]),
  );
  const bindingValid = observation.requests.every((request, index) => {
    const status = terminal.requests[index];
    if (status.status === 'deferred') {
      return (
        status.receipt_id === null &&
        !recipient.some((row) => row.request_id === request.request_id)
      );
    }
    const row = receipts.get(status.receipt_id);
    return status.status === 'completed' && row && sameCell(row, request);
  });
  const fields = {
    within_approved_cap: terminal.distinct_cells <= observation.policy.max_distinct_protected_cells,
    no_duplicate_recipient_delivery: recipient.length === 1,
    approved_work_completed: overlap
      ? aStatus.status === 'completed' &&
        bStatus.status === 'completed' &&
        aStatus.receipt_id === bStatus.receipt_id
      : aStatus.status === 'completed' && bStatus.status === 'deferred',
    receipt_and_source_lineage: bindingValid && terminal.lineage_valid,
    native_dob_etl_continues: terminal.native_etl_receipts.length === 1,
    native_full_stage_retry_denied: terminal.native_full_stage_retry_denied,
  };
  return { exact: Object.values(fields).every(Boolean), fields };
}

export async function replay({ seed, kind, worker, workerFile }) {
  assert.ok(['overlap', 'distinct'].includes(kind));
  assert.ok(workerFile || Object.hasOwn(workers, worker));
  const v34 = produceCase(seed, kind);
  const observation = {
    schema_version: 'f10-v37-uncoached-remote-worker-g0',
    policy: v34.observation.policy,
    source_stage: v34.observation.source_stage,
    requests: v34.observation.requests,
    sink_contract:
      'separate durable process; same key idempotent; normal recipient receipt lookup available',
  };
  const [a, b] = observation.requests;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v37-remote-'));
  const admissionPath = path.join(directory, 'admission.sqlite');
  const sinkPath = path.join(directory, 'recipient.sqlite');
  const init = new DatabaseSync(admissionPath);
  v35First.initializeStore(init, { ...observation, requests: [a] });
  init.close();
  const recipient = new DatabaseSync(sinkPath);
  recipient.exec(`CREATE TABLE deliveries (
    receipt_id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
    stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
    value_sha256 TEXT NOT NULL, writer_pid INTEGER NOT NULL
  )`);
  recipient.close();
  try {
    const remoteSink = remoteClient(sinkPath);
    const module = workerFile
      ? await import(
          `${pathToFileURL(fs.realpathSync(workerFile)).href}?content=${crypto.createHash('sha256').update(fs.readFileSync(workerFile)).digest('hex')}`
        )
      : workers[worker];
    const firstDb = new DatabaseSync(admissionPath);
    const trace = [];
    try {
      await module.release(workerDb(firstDb, remoteSink), a.request_id);
      throw new Error('expected-lost-ack');
    } catch (error) {
      if (error.status !== 75) {
        throw error;
      }
      const accepted = sinkRows(sinkPath, a.job_id, a.recipient_id);
      assert.equal(accepted.length, 1);
      trace.push({
        phase: 'A-durable-ACK-lost',
        remote_receipt_id: accepted[0].receipt_id,
        sink_pid: accepted[0].writer_pid,
      });
    } finally {
      firstDb.close();
    }
    const restarted = new DatabaseSync(admissionPath);
    addRequest(restarted, b);
    const proxy = workerDb(restarted, remoteSink);
    trace.push({
      phase: 'B-arrives-before-A-recovery',
      result: await module.release(proxy, b.request_id),
    });
    trace.push({ phase: 'A-retry', result: await module.release(proxy, a.request_id) });
    const requests = restarted.prepare('SELECT * FROM requests ORDER BY rowid').all();
    const localSink = restarted.prepare('SELECT * FROM sink ORDER BY rowid').all();
    restarted.close();
    const remote = sinkRows(sinkPath, a.job_id, a.recipient_id);
    const sourceByCell = new Map(
      observation.source_stage.source_cells.map((cell) => [
        `${cell.row}|${cell.column}`,
        cell.value_sha256,
      ]),
    );
    const native = replayCase(seed, kind, 'safe-atomic').terminal;
    const terminal = {
      remote_sink: remote,
      local_sink_shadow: localSink,
      requests,
      distinct_cells: new Set(remote.map((row) => `${row.report_ref}|${row.cell_key}`)).size,
      lineage_valid: remote.every(
        (row) =>
          row.job_id === a.job_id &&
          row.recipient_id === a.recipient_id &&
          row.stage_ref === a.stage_ref &&
          row.report_ref === a.report_ref &&
          row.value_sha256 === sourceByCell.get(row.cell_key),
      ),
      native_etl_receipts: native.native_etl_sink.map((entry) => entry.receipt.receipt_id),
      native_full_stage_retry_denied: native.full_source_retry_denied,
    };
    return {
      observation,
      kind,
      worker: workerFile ? 'submitted-worker' : worker,
      trace,
      terminal,
      score: grade(observation, terminal),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
