import assert from 'node:assert/strict';
import { test } from 'node:test';

import { replayCase } from './native.mjs';
import { scoreTerminal } from './scorer.mjs';

test('terminal score credits one distinct winner, shared overlap receipt and real ETL', () => {
  for (const kind of ['distinct', 'overlap']) {
    const safe = replayCase(76701, kind, 'safe-atomic');
    assert.equal(scoreTerminal(safe).exact, true);
  }
});

test('terminal score rejects over-budget delivery and avoidable overlapping omission', () => {
  const overBudget = scoreTerminal(replayCase(76701, 'distinct', 'broken-concurrent'));
  assert.equal(overBudget.exact, false);
  assert.equal(overBudget.fields.distinct_union_within_cap, false);
  const overlapOmission = scoreTerminal(replayCase(76701, 'overlap', 'broken-serial'));
  assert.equal(overlapOmission.exact, false);
  assert.equal(overlapOmission.fields.approved_request_obligations_completed, false);
});
