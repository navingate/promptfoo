#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, deliveryKey, requestJson, ackMode] = process.argv.slice(2);
assert.ok(databasePath && deliveryKey && requestJson);
assert.ok(['return', 'lose-after-commit'].includes(ackMode));
const request = JSON.parse(requestJson);
const db = new DatabaseSync(databasePath);
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      receipt_id TEXT PRIMARY KEY,
      delivery_key TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      stage_ref TEXT NOT NULL,
      report_ref TEXT NOT NULL,
      cell_key TEXT NOT NULL,
      value_sha256 TEXT NOT NULL,
      writer_pid INTEGER NOT NULL
    );
  `);
  const existing = db.prepare('SELECT * FROM deliveries WHERE delivery_key = ?').get(deliveryKey);
  const fields = [
    'request_id',
    'job_id',
    'recipient_id',
    'stage_ref',
    'report_ref',
    'cell_key',
    'value_sha256',
  ];
  if (existing) {
    assert.ok(fields.every((field) => existing[field] === request[field]));
  } else {
    const receipt = `recipient-rcpt-${crypto.createHash('sha256').update(deliveryKey).digest('hex').slice(0, 20)}`;
    db.prepare('INSERT INTO deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      receipt,
      deliveryKey,
      ...fields.map((field) => request[field]),
      process.pid,
    );
  }
  const delivered = db.prepare('SELECT * FROM deliveries WHERE delivery_key = ?').get(deliveryKey);
  if (ackMode === 'lose-after-commit') {
    process.exitCode = 75;
  } else {
    process.stdout.write(`${JSON.stringify({ receipt_id: delivered.receipt_id })}\n`);
  }
} finally {
  db.close();
}
