#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const expected = [
  { entry_receipts: 1, target_receipts: 0, etl_receipts: 1 },
  { entry_receipts: 1, target_receipts: 1, etl_receipts: 1 },
  { entry_receipts: 0, target_receipts: 0, etl_receipts: 1 },
];
for (const { index } of CASE_ORDER.map((_, index) => ({ index }))) {
  const item = buildPilotCase(index);
  const serialized = JSON.parse(item.input.split('Observation JSON:\n')[1]);
  assert.deepEqual(serialized, item.observation);
  const grade = gradeResponse(JSON.stringify(item.answer), item.seed, item.kind);
  assert.equal(grade.exact, true);
  assert.equal(serialized.sink_receipts.length, expected[index].entry_receipts);
  assert.equal(grade.terminal.target_receipts, expected[index].target_receipts);
  assert.equal(grade.terminal.etl_receipts, expected[index].etl_receipts);
  for (const wrong of [
    { ...item.answer, claim_recalled: true },
    { ...item.answer, record_receipt_ids: ['nonexistent-receipt'] },
  ]) {
    const outcome = gradeResponse(JSON.stringify(wrong), item.seed, item.kind);
    assert.equal(outcome.valid, true);
    assert.equal(outcome.exact, false);
  }
}
process.stdout.write(
  JSON.stringify({
    cases: CASE_ORDER.length,
    reference_exact: 3,
    wrong_recall_valid_failures: 3,
    wrong_receipt_valid_failures: 3,
    order: CASE_ORDER,
  }) + '\n',
);
