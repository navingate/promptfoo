import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceCase, replayCase } from './native.mjs';

test('matched requests change only the second source cell and its value hash', () => {
  const distinct = produceCase(76701, 'distinct').observation;
  const overlap = produceCase(76701, 'overlap').observation;
  assert.deepEqual(distinct.requests[0], overlap.requests[0]);
  assert.deepEqual(
    { ...distinct.requests[1], cell_key: null, value_sha256: null },
    { ...overlap.requests[1], cell_key: null, value_sha256: null },
  );
  assert.notEqual(distinct.requests[1].cell_key, overlap.requests[1].cell_key);
  assert.notEqual(distinct.requests[1].value_sha256, overlap.requests[1].value_sha256);
});

test('two stale eligibility reads can deliver distinct cells beyond the shared approved cap', () => {
  const result = replayCase(76701, 'distinct', 'broken-concurrent');
  assert.equal(result.observation.policy.max_distinct_protected_cells, 1);
  assert.deepEqual(
    result.trace.map((step) => step.phase),
    ['worker-a-precheck', 'worker-b-precheck', 'worker-a-deliver', 'worker-b-deliver'],
  );
  assert.equal(result.terminal.sink.length, 2);
  assert.equal(result.terminal.distinct_sink_cells, 2);
  assert.equal(result.terminal.over_budget, true);
  assert.equal(result.terminal.native_etl_sink.length, 1);
});

test('a request-count precheck loses an approved overlapping obligation', () => {
  const result = replayCase(76701, 'overlap', 'broken-serial');
  assert.equal(result.terminal.sink.length, 1);
  assert.equal(result.terminal.distinct_sink_cells, 1);
  assert.equal(result.terminal.over_budget, false);
  assert.deepEqual(
    result.terminal.request_statuses.map((r) => r.status),
    ['completed', 'deferred'],
  );
  assert.equal(result.terminal.native_etl_sink.length, 1);
});

test('one transaction-safe repair admits one distinct winner and defers the other', () => {
  const result = replayCase(76701, 'distinct', 'safe-atomic');
  assert.equal(result.terminal.sink.length, 1);
  assert.equal(result.terminal.distinct_sink_cells, 1);
  assert.equal(result.terminal.over_budget, false);
  assert.deepEqual(
    result.terminal.request_statuses.map((r) => r.status),
    ['completed', 'deferred'],
  );
  assert.equal(result.terminal.native_etl_sink.length, 1);
});

test('the same transaction-safe repair completes overlapping obligations idempotently', () => {
  const result = replayCase(76701, 'overlap', 'safe-atomic');
  assert.equal(result.terminal.sink.length, 1);
  assert.equal(result.terminal.distinct_sink_cells, 1);
  assert.equal(result.terminal.over_budget, false);
  assert.deepEqual(
    result.terminal.request_statuses.map((r) => r.status),
    ['completed', 'completed'],
  );
  assert.equal(
    result.terminal.request_statuses[0].receipt_id,
    result.terminal.request_statuses[1].receipt_id,
  );
  assert.equal(result.terminal.native_etl_sink.length, 1);
  assert.equal(result.terminal.full_source_retry_denied, true);
});

test('a repeated approved request reuses its durable receipt after the two-worker drain', () => {
  for (const kind of ['distinct', 'overlap']) {
    const result = replayCase(76701, kind, 'safe-atomic');
    assert.equal(result.trace[2].phase, 'worker-a-retry');
    assert.deepEqual(result.trace[2].result, result.trace[0].result);
    assert.equal(result.terminal.sink.length, 1);
  }
});
