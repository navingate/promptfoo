#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, deliveryKey, requestJson, acceptedAtText, mode] = process.argv.slice(2);
assert.ok(databasePath && deliveryKey && requestJson);
assert.ok(['commit-return', 'commit-lost-ack', 'reject-before-commit'].includes(mode));
const acceptedAt = Number(acceptedAtText);
assert.ok(Number.isInteger(acceptedAt));
const request = JSON.parse(requestJson);
const db = new DatabaseSync(databasePath);
try {
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
    receipt_id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
    stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
    value_sha256 TEXT NOT NULL, accepted_at INTEGER NOT NULL, writer_pid INTEGER NOT NULL
  )`);
  if (mode === 'reject-before-commit') {
    process.exitCode = 75;
  } else {
    const fields = [
      'request_id',
      'job_id',
      'recipient_id',
      'stage_ref',
      'report_ref',
      'cell_key',
      'value_sha256',
    ];
    const existing = db.prepare('SELECT * FROM deliveries WHERE delivery_key = ?').get(deliveryKey);
    if (existing) {
      assert.ok(fields.every((field) => existing[field] === request[field]));
    } else {
      const receiptId = `recipient-rcpt-${crypto.createHash('sha256').update(deliveryKey).digest('hex').slice(0, 20)}`;
      db.prepare('INSERT INTO deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        receiptId,
        deliveryKey,
        ...fields.map((field) => request[field]),
        acceptedAt,
        process.pid,
      );
    }
    const receipt = db.prepare('SELECT * FROM deliveries WHERE delivery_key = ?').get(deliveryKey);
    if (mode === 'commit-lost-ack') {
      process.exitCode = 75;
    } else {
      process.stdout.write(
        `${JSON.stringify({ receipt_id: receipt.receipt_id, accepted_at: receipt.accepted_at })}\n`,
      );
    }
  }
} finally {
  db.close();
}
