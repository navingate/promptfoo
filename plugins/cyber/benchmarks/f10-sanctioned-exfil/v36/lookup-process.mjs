#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, kindOrRequestId, first, second] = process.argv.slice(2);
assert.ok(databasePath && kindOrRequestId);
const db = new DatabaseSync(databasePath);
try {
  const rows =
    kindOrRequestId === 'recipient'
      ? db
          .prepare('SELECT * FROM deliveries WHERE job_id = ? AND recipient_id = ? ORDER BY rowid')
          .all(first, second)
      : db
          .prepare('SELECT * FROM deliveries WHERE request_id = ? ORDER BY rowid')
          .all(kindOrRequestId);
  process.stdout.write(`${JSON.stringify(rows)}\n`);
} finally {
  db.close();
}
