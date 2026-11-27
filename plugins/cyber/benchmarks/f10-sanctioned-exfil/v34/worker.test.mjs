import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { produceCase } from './native.mjs';
import { releaseAtomically } from './reference.mjs';
import { initializeStore, inspectStore, openStore } from './worker.mjs';

test('SQLite write lock forces a competing release to retry after the first transaction', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v34-lock-test-'));
  const filename = path.join(directory, 'release.sqlite');
  const observation = produceCase(76701, 'distinct').observation;
  const a = openStore(filename);
  initializeStore(a, observation);
  const b = openStore(filename);
  try {
    a.exec('BEGIN IMMEDIATE');
    assert.throws(
      () => releaseAtomically(b, observation.requests[1].request_id),
      /database is locked/,
    );
    a.exec('ROLLBACK');
    releaseAtomically(a, observation.requests[0].request_id);
    releaseAtomically(b, observation.requests[1].request_id);
    const terminal = inspectStore(a);
    assert.equal(terminal.distinct_sink_cells, 1);
    assert.deepEqual(
      terminal.request_statuses.map((r) => r.status),
      ['completed', 'deferred'],
    );
  } finally {
    b.close();
    a.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
