#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [phase, databasePath, firstId, secondId] = process.argv.slice(2);
assert.ok(['first', 'resume'].includes(phase));
assert.ok(databasePath && firstId && secondId);
let messageId = 0;
let incoming = '';

function readLine() {
  const buffer = Buffer.allocUnsafe(4096);
  while (!incoming.includes('\n')) {
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) {
      throw new Error('broker-closed');
    }
    incoming += buffer.toString('utf8', 0, count);
  }
  const end = incoming.indexOf('\n');
  const line = incoming.slice(0, end);
  incoming = incoming.slice(end + 1);
  return line;
}

function requestBroker(operation, args) {
  const id = ++messageId;
  fs.writeSync(1, `${JSON.stringify({ rpc: 'f10-v38', id, operation, args })}\n`);
  const response = JSON.parse(readLine());
  assert.equal(response.rpc_response, id);
  if (!response.ok) {
    const error = new Error(response.error?.message ?? 'recipient-service-error');
    error.code = response.error?.code;
    throw error;
  }
  return response.value;
}

const remoteSink = {
  send(deliveryKey, request) {
    return requestBroker('send', { deliveryKey, request });
  },
  lookupRecipient(jobId, recipientId) {
    return requestBroker('lookupRecipient', { jobId, recipientId });
  },
};

function workerDb(db) {
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
              const deliveryKey = args[0];
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
              remoteSink.send(deliveryKey, request);
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

const { release } = await import('./release-worker.mjs');
assert.equal(typeof release, 'function');
const db = new DatabaseSync(databasePath);
try {
  const proxy = workerDb(db);
  if (phase === 'first') {
    try {
      await release(proxy, firstId);
    } catch (error) {
      if (error.code !== 'ACK_LOST') {
        throw error;
      }
    }
  } else {
    await release(proxy, secondId);
    await release(proxy, firstId);
  }
  fs.writeSync(1, `${JSON.stringify({ phase_complete: phase })}\n`);
} finally {
  db.close();
}
