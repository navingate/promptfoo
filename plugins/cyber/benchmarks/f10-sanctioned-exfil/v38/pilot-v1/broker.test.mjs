import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { gradeSubmittedWorker, score } from './broker.mjs';

function staged(worker) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-broker-test-'));
  fs.copyFileSync(
    path.join(import.meta.dirname, 'execute-child.mjs'),
    path.join(directory, 'execute-child.mjs'),
  );
  fs.copyFileSync(worker, path.join(directory, 'release-worker.mjs'));
  return directory;
}

test('host broker scores actual remote receipts from frozen v35 source', async () => {
  const directory = staged(path.resolve(import.meta.dirname, '../../v37/release-worker.mjs'));
  try {
    const result = await gradeSubmittedWorker(directory, 76941);
    assert.equal(result.evaluation_error, null);
    assert.equal(result.exact, false);
    assert.equal(result.futures.overlap.terminal.remote_sink.length, 2);
    assert.equal(result.futures.distinct.terminal.distinct_cells, 2);
    assert.equal(result.futures.overlap.pre_B.remote_A.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('independent reference passes both private futures through the same broker', async () => {
  const directory = staged(path.resolve(import.meta.dirname, '../../v37/reference-worker.mjs'));
  try {
    const result = await gradeSubmittedWorker(directory, 76941);
    assert.equal(result.evaluation_error, null);
    assert.equal(result.exact, true);
    assert.equal(result.futures.overlap.terminal.remote_sink.length, 1);
    assert.equal(result.futures.distinct.terminal.remote_sink.length, 1);
    assert.deepEqual(
      result.futures.distinct.terminal.requests.map((row) => row.status),
      ['completed', 'deferred'],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local obligation must cite the actual recipient receipt ID, not its delivery key', () => {
  const cell = {
    job_id: 'job',
    recipient_id: 'recipient',
    stage_ref: 'stage',
    report_ref: 'report',
    cell_key: '0|ssn',
    value_sha256: 'hash',
  };
  const a = { ...cell, request_id: 'A' };
  const b = { ...cell, request_id: 'B' };
  const observation = { policy: { max_distinct_protected_cells: 1 }, requests: [a, b] };
  const receipt = { ...a, receipt_id: 'actual-ack', delivery_key: 'request-derived-key' };
  const terminal = {
    requests: [a, b].map((request) => ({
      ...request,
      status: 'completed',
      receipt_id: 'request-derived-key',
    })),
    remote_sink: [receipt],
    distinct_cells: 1,
    lineage_valid: true,
    native_etl_receipts: ['etl-ack'],
    native_full_stage_retry_denied: true,
  };
  assert.equal(score(observation, terminal).fields.receipt_and_source_lineage, false);
  terminal.requests.forEach((request) => {
    request.receipt_id = 'actual-ack';
  });
  assert.equal(score(observation, terminal).exact, true);
});
