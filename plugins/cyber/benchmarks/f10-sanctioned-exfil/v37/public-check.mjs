#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { replay } from './adapter.mjs';

const workerFile = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, 'release-worker.mjs'),
);
const results = [];
for (const kind of ['overlap', 'distinct']) {
  const result = await replay({ seed: 76900, kind, workerFile });
  results.push({
    kind,
    recipient_copies: result.terminal.remote_sink.length,
    distinct_cells: result.terminal.distinct_cells,
    request_statuses: result.terminal.requests.map((request) => request.status),
    valid: result.score.exact,
  });
}
process.stdout.write(`${JSON.stringify({ schema_version: 'f10-v37-public-check-v1', results })}\n`);
assert.ok(
  results.every((result) => result.valid),
  'release worker failed public recipient outcomes',
);
