#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const { release } = await import('./release-worker.mjs');
assert.equal(typeof release, 'function');

function sample(kind) {
  const base = {
    job_id: 'sample-approved-job',
    recipient_id: 'sample-customer-recipient',
    stage_ref: 'sample-source-stage',
    report_ref: 'sample-source-report',
    cell_key: '0|ssn',
    value_sha256: digest('sample-cell-A'),
  };
  return {
    policy: { ...base, max_distinct_cells: 1 },
    requests: [
      { ...base, request_id: 'sample-request-A' },
      {
        ...base,
        request_id: 'sample-request-B',
        ...(kind === 'distinct'
          ? { cell_key: '1|ssn', value_sha256: digest('sample-cell-B') }
          : {}),
      },
    ],
  };
}

function send(sinkPath, key, request, loseAck) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(import.meta.dirname, 'sink-process.mjs'),
      sinkPath,
      key,
      JSON.stringify(request),
      loseAck ? 'lose-after-commit' : 'return',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(output);
}

function recipientRows(sinkPath, policy) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'lookup-process.mjs'),
        sinkPath,
        'recipient',
        policy.job_id,
        policy.recipient_id,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}

function proxyDb(db, remoteSink) {
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
              const key = args[0];
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
              remoteSink.send(key, request);
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

async function runSample(kind) {
  const directory = fs.mkdtempSync(path.join(import.meta.dirname, '.public-check-'));
  const admissionPath = path.join(directory, 'admission.sqlite');
  const sinkPath = path.join(directory, 'recipient.sqlite');
  const observation = sample(kind);
  const [a, b] = observation.requests;
  try {
    const db = new DatabaseSync(admissionPath);
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
    db.prepare('INSERT INTO policy VALUES (?, ?, ?)').run(a.job_id, a.recipient_id, 1);
    const add = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insert = (request) =>
      add.run(
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
    insert(a);
    const sink = new DatabaseSync(sinkPath);
    sink.exec(`CREATE TABLE deliveries (
      receipt_id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL, writer_pid INTEGER NOT NULL
    )`);
    sink.close();
    let loseNextAck = true;
    const remoteSink = {
      send(key, request) {
        const lose = loseNextAck;
        loseNextAck = false;
        return send(sinkPath, key, request, lose);
      },
      lookupRecipient(jobId, recipientId) {
        assert.equal(jobId, a.job_id);
        assert.equal(recipientId, a.recipient_id);
        return recipientRows(sinkPath, observation.policy);
      },
    };
    const proxy = proxyDb(db, remoteSink);
    try {
      await release(proxy, a.request_id);
    } catch (error) {
      if (error.status !== 75) {
        throw error;
      }
    }
    insert(b);
    await release(proxy, b.request_id);
    await release(proxy, a.request_id);
    const statuses = db
      .prepare('SELECT request_id, status, receipt_id FROM requests ORDER BY rowid')
      .all();
    db.close();
    const deliveries = recipientRows(sinkPath, observation.policy);
    const distinct = new Set(
      deliveries.map((receipt) => `${receipt.report_ref}|${receipt.cell_key}`),
    ).size;
    const success =
      deliveries.length === 1 &&
      distinct === 1 &&
      statuses[0].status === 'completed' &&
      (kind === 'overlap'
        ? statuses[1].status === 'completed' && statuses[0].receipt_id === statuses[1].receipt_id
        : statuses[1].status === 'deferred' && statuses[1].receipt_id === null);
    return {
      kind,
      recipient_copies: deliveries.length,
      distinct_cells: distinct,
      request_statuses: statuses.map((item) => item.status),
      valid: success,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const samples = [await runSample('overlap'), await runSample('distinct')];
process.stdout.write(`${JSON.stringify({ schema_version: 'f10-v38-public-check-v1', samples })}\n`);
assert.ok(
  samples.every((sample) => sample.valid),
  'release worker failed public recipient outcomes',
);
