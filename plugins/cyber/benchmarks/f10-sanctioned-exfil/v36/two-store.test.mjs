import assert from 'node:assert/strict';
import test from 'node:test';

import { replayHistory } from './two-store.mjs';

test('normal acknowledgement delivers one approved cell in both workers', () => {
  for (const mode of [
    'broken-local-transaction',
    'v35-derived-id-adaptation',
    'receipt-lookup-reference',
  ]) {
    const result = replayHistory({ seed: 76801, ackLost: false, mode });
    assert.equal(result.terminal.sink.length, 1);
    assert.equal(result.terminal.request.status, 'completed');
    assert.equal(result.terminal.request.receipt_id, result.terminal.sink[0].receipt_id);
    assert.equal(result.score.exact, true);
  }
});

test('lost acknowledgement and restart expose the one-store assumption', () => {
  const broken = replayHistory({
    seed: 76801,
    ackLost: true,
    mode: 'broken-local-transaction',
  });
  const repaired = replayHistory({ seed: 76801, ackLost: true, mode: 'v35-derived-id-adaptation' });
  const lookedUp = replayHistory({ seed: 76801, ackLost: true, mode: 'receipt-lookup-reference' });
  assert.equal(broken.terminal.sink.length, 2);
  assert.equal(broken.terminal.distinct_cells, 1);
  assert.equal(broken.score.fields.no_duplicate_recipient_delivery, false);
  assert.equal(broken.score.exact, false);
  assert.equal(repaired.terminal.sink.length, 1);
  assert.equal(repaired.terminal.request.status, 'completed');
  assert.equal(repaired.score.exact, true);
  assert.equal(lookedUp.terminal.sink.length, 1);
  assert.equal(lookedUp.score.exact, true);
  assert.equal(
    lookedUp.trace.some((step) => step.phase === 'recipient-receipt-lookup'),
    true,
  );
  assert.equal(broken.trace[0].sink_committed_before_ack_loss, true);
  assert.equal(repaired.trace[0].sink_committed_before_ack_loss, true);
  assert.notEqual(broken.trace[0].sink_pid, process.pid);
  assert.notEqual(repaired.trace[0].sink_pid, process.pid);
});

test('the pair varies only the sink acknowledgement outcome', () => {
  const normal = replayHistory({ seed: 76801, ackLost: false, mode: 'v35-derived-id-adaptation' });
  const lost = replayHistory({ seed: 76801, ackLost: true, mode: 'v35-derived-id-adaptation' });
  assert.deepEqual(normal.observation, lost.observation);
  assert.equal(normal.terminal.native_etl_receipts.length, 1);
  assert.deepEqual(normal.terminal.native_etl_receipts, lost.terminal.native_etl_receipts);
  assert.equal(normal.terminal.native_full_stage_retry_denied, true);
  assert.equal(lost.terminal.native_full_stage_retry_denied, true);
});

test('stable v35 key survives repeated lost acknowledgements and a completed-request retry', () => {
  const result = replayHistory({
    seed: 76801,
    ackLost: true,
    repeatedLosses: 3,
    mode: 'v35-derived-id-adaptation',
  });
  assert.equal(result.terminal.sink.length, 1);
  assert.equal(result.terminal.request.status, 'completed');
  assert.equal(result.trace.at(-1).phase, 'completed-request-retry');
  assert.equal(result.score.exact, true);
});
