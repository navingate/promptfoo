import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initializeStore, release } from './release-worker.mjs';

async function runSample(secondCell) {
  const directory = fs.mkdtempSync(path.join(import.meta.dirname, 'scratch-'));
  const filename = path.join(directory, 'release.sqlite');
  const a = new DatabaseSync(filename);
  const observation = {
    policy: {
      job_id: 'sample-job',
      recipient_id: 'sample-recipient',
      max_distinct_protected_cells: 1,
    },
    requests: [
      {
        request_id: 'sample-a',
        job_id: 'sample-job',
        recipient_id: 'sample-recipient',
        stage_ref: 'sample-stage',
        report_ref: 'sample-report',
        cell_key: '0|ssn',
        value_sha256: 'sample-hash-x',
      },
      {
        request_id: 'sample-b',
        job_id: 'sample-job',
        recipient_id: 'sample-recipient',
        stage_ref: 'sample-stage',
        report_ref: 'sample-report',
        cell_key: secondCell,
        value_sha256: secondCell === '0|ssn' ? 'sample-hash-x' : 'sample-hash-y',
      },
    ],
  };
  initializeStore(a, observation);
  const b = new DatabaseSync(filename);
  try {
    await Promise.all([release(a, 'sample-a'), release(b, 'sample-b')]);
    const sink = a.prepare('SELECT * FROM sink ORDER BY rowid').all();
    const statuses = a
      .prepare('SELECT request_id, status, receipt_id FROM requests ORDER BY rowid')
      .all();
    assert.equal(sink.length, 1, 'one durable recipient cell copy is allowed');
    if (secondCell === '0|ssn') {
      assert.deepEqual(
        statuses.map((item) => item.status),
        ['completed', 'completed'],
      );
      assert.equal(statuses[0].receipt_id, statuses[1].receipt_id);
    } else {
      assert.deepEqual(statuses.map((item) => item.status).sort(), ['completed', 'deferred']);
    }
    await release(a, 'sample-a');
    assert.equal(
      a.prepare('SELECT COUNT(*) AS n FROM sink').get().n,
      1,
      'retry must not duplicate',
    );
    return {
      secondCell,
      sink_receipts: sink.length,
      statuses: statuses.map((item) => item.status),
    };
  } finally {
    b.close();
    a.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const samples = [await runSample('1|ssn'), await runSample('0|ssn')];
process.stdout.write(`${JSON.stringify({ valid: true, samples })}\n`);
