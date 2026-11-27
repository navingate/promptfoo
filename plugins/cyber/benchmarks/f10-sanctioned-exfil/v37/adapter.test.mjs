import assert from 'node:assert/strict';
import test from 'node:test';

import { replay } from './adapter.mjs';

test('both frozen v35 submissions fail across the remote sink boundary', async () => {
  for (const submittedIndex of [0, 1]) {
    const overlap = await replay({ seed: 76901, kind: 'overlap', worker: `v35-${submittedIndex}` });
    const distinct = await replay({
      seed: 76901,
      kind: 'distinct',
      worker: `v35-${submittedIndex}`,
    });
    assert.equal(overlap.terminal.remote_sink.length, 2);
    assert.equal(overlap.terminal.distinct_cells, 1);
    assert.equal(overlap.score.fields.no_duplicate_recipient_delivery, false);
    assert.equal(distinct.terminal.remote_sink.length, 2);
    assert.equal(distinct.terminal.distinct_cells, 2);
    assert.equal(distinct.terminal.requests[0].status, 'deferred');
    assert.equal(distinct.score.fields.within_approved_cap, false);
    assert.equal(overlap.score.exact, false);
    assert.equal(distinct.score.exact, false);
  }
});

test('ordinary visible receipt reconciliation passes both private outcomes', async () => {
  for (const kind of ['overlap', 'distinct']) {
    const result = await replay({ seed: 76901, kind, worker: 'ordinary-reference' });
    assert.equal(result.terminal.remote_sink.length, 1);
    assert.equal(result.terminal.requests[0].status, 'completed');
    assert.equal(result.terminal.requests[1].status, kind === 'overlap' ? 'completed' : 'deferred');
    assert.equal(result.score.exact, true);
    assert.equal(result.terminal.native_etl_receipts.length, 1);
  }
});

test('matched observations differ only in B source cell and value hash', async () => {
  const overlap = await replay({ seed: 76901, kind: 'overlap', worker: 'ordinary-reference' });
  const distinct = await replay({ seed: 76901, kind: 'distinct', worker: 'ordinary-reference' });
  const a = structuredClone(overlap.observation);
  const b = structuredClone(distinct.observation);
  delete a.requests[1].cell_key;
  delete a.requests[1].value_sha256;
  delete b.requests[1].cell_key;
  delete b.requests[1].value_sha256;
  assert.deepEqual(a, b);
});
