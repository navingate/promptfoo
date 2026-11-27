import assert from 'node:assert/strict';
import test from 'node:test';

import { replayCrossRequest } from './cross-request.mjs';

test('v35 request-key adaptation fails on an overlapping new request after lost A ACK', () => {
  const result = replayCrossRequest({
    seed: 76801,
    kind: 'overlap',
    mode: 'v35-request-key-adaptation',
  });
  assert.equal(result.trace[0].recipient_committed_before_ack_loss, true);
  assert.equal(result.terminal.sink.length, 2);
  assert.equal(result.terminal.distinct_cells, 1);
  assert.equal(result.score.fields.no_duplicate_recipient_delivery, false);
  assert.equal(result.score.exact, false);
});

test('v35 request-key adaptation exceeds cap and loses A obligation on distinct B', () => {
  const result = replayCrossRequest({
    seed: 76801,
    kind: 'distinct',
    mode: 'v35-request-key-adaptation',
  });
  assert.equal(result.terminal.sink.length, 2);
  assert.equal(result.terminal.distinct_cells, 2);
  assert.equal(result.terminal.requests[0].status, 'deferred');
  assert.equal(result.score.fields.distinct_union_within_cap, false);
  assert.equal(result.score.exact, false);
});

test('ordinary authoritative recipient lookup protects both matched B requests', () => {
  for (const kind of ['overlap', 'distinct']) {
    const result = replayCrossRequest({ seed: 76801, kind, mode: 'ordinary-recipient-reconcile' });
    assert.equal(result.terminal.sink.length, 1);
    assert.equal(result.terminal.distinct_cells, 1);
    assert.equal(result.terminal.requests[0].status, 'completed');
    assert.equal(result.terminal.requests[1].status, kind === 'overlap' ? 'completed' : 'deferred');
    assert.equal(result.score.exact, true);
    assert.equal(result.terminal.native_etl_receipts.length, 1);
  }
});

test('the two B histories change only B source cell and value hash', () => {
  const overlap = replayCrossRequest({
    seed: 76801,
    kind: 'overlap',
    mode: 'ordinary-recipient-reconcile',
  });
  const distinct = replayCrossRequest({
    seed: 76801,
    kind: 'distinct',
    mode: 'ordinary-recipient-reconcile',
  });
  const a = structuredClone(overlap.observation);
  const b = structuredClone(distinct.observation);
  assert.equal(a.requests[0].request_id, b.requests[0].request_id);
  delete a.requests[1].cell_key;
  delete a.requests[1].value_sha256;
  delete b.requests[1].cell_key;
  delete b.requests[1].value_sha256;
  assert.deepEqual(a, b);
});
