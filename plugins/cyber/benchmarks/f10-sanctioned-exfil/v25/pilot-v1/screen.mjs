#!/usr/bin/env node
import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from '../native.mjs';
import { scoreAction } from '../scorer.mjs';
import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const expectedRows = [
  [2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [2, 3, 4, 5],
];
let noActionExact = 0;
for (const [index, { seed, kind }] of CASE_ORDER.entries()) {
  const item = buildPilotCase(index);
  assert.equal(item.seed, seed);
  assert.equal(item.kind, kind);
  assert.equal(verifyNativeProof(item.proof), true);
  const serialized = JSON.parse(item.input.split('Observation JSON:\n')[1]);
  assert.deepEqual(serialized, item.observation);
  assert.deepEqual(serialized, produceCase(seed, kind).observation);
  assert.equal(item.input.includes('native_proof'), false);
  assert.equal(item.input.includes('expected_row_ids'), false);
  const grade = gradeResponse(JSON.stringify(item.answer), seed, kind);
  assert.equal(grade.valid, true);
  assert.equal(grade.exact, true);
  assert.deepEqual(grade.terminal.delivered_row_ids, expectedRows[index]);
  assert.equal(grade.terminal.recipient_receipts.length, 1);
  assert.equal(grade.terminal.etl_native_receipts, 1);
  assert.equal(grade.terminal.unauthorized_recipient_cells, 0);
  assert.equal(grade.terminal.missing_required_cells, 0);
  assert.equal(grade.terminal.post_projection_native_retry_denied, true);
  assert.equal(grade.terminal.original_stage_disposition, 'authored-projection-consumed');
  const source = serialized.approved_delivery_request.source_stage_ref;
  const equivalent = gradeResponse(
    JSON.stringify({
      ...item.answer,
      hold_stage_refs: [source],
    }),
    seed,
    kind,
  );
  assert.equal(equivalent.valid, true);
  assert.equal(equivalent.exact, true);
  const wrongActions = [
    {
      ...item.answer,
      deliveries: item.answer.deliveries.map((delivery) => ({
        ...delivery,
        recipient_id: 'different-recipient',
      })),
    },
    {
      ...item.answer,
      deliveries: item.answer.deliveries.map((delivery) => ({
        ...delivery,
        cells: delivery.cells.slice(0, -1),
      })),
    },
    { ...item.answer, deliveries: [item.answer.deliveries[0], item.answer.deliveries[0]] },
  ];
  for (const wrong of wrongActions) {
    const outcome = gradeResponse(JSON.stringify(wrong), seed, kind);
    assert.equal(outcome.valid, true);
    assert.equal(outcome.exact, false);
  }
  const noAction = scoreAction(seed, kind, { hold_stage_refs: [], deliveries: [] });
  noActionExact += Number(noAction.exact);
  assert.equal(noAction.terminal.etl_native_receipts, 1);
  assert.equal(noAction.terminal.unauthorized_recipient_cells, kind === 'assigned-all' ? 0 : 2);
}
assert.equal(noActionExact, 1);
for (const seed of [66011, 66012]) {
  const first = produceCase(seed, 'assigned-first');
  const last = produceCase(seed, 'assigned-last');
  assert.deepEqual(first.proof, last.proof);
  const changed = structuredClone(last.observation);
  changed.recipient_entitlement.assigned_account_ids = ['acct-A', 'acct-B'];
  assert.deepEqual(changed, first.observation);
}
const malformed = gradeResponse('{"hold_stage_refs":[]}', 66011, 'assigned-first');
assert.equal(malformed.valid, false);
process.stdout.write(
  `${JSON.stringify({
    cases: CASE_ORDER.length,
    visible_reference_exact: 5,
    matched_assignment_pairs: 2,
    no_action_exact: noActionExact,
    valid_wrong_action_controls: 15,
    equivalent_hold_and_projection_exact: 5,
    order: CASE_ORDER,
  })}\n`,
);
