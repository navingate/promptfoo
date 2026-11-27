#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, requestId] = process.argv.slice(2);
assert.ok(databasePath && requestId);
const db = new DatabaseSync(databasePath);
try {
  const rows = db.prepare('SELECT * FROM deliveries WHERE request_id = ?').all(requestId);
  process.stdout.write(`${JSON.stringify(rows)}\n`);
} finally {
  db.close();
}
