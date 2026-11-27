import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPilotCase, CASE_ORDER, gradeResponse, PROMPT } from './pilot.mjs';

test('four fresh slots form two matched effective-time pairs and visible reference passes exact interface', () => {
  assert.deepEqual(CASE_ORDER, [
    { seed: 68021, arm: 'early' },
    { seed: 68022, arm: 'late' },
    { seed: 68021, arm: 'late' },
    { seed: 68022, arm: 'early' },
  ]);
  assert.ok(PROMPT.includes('internal queue does not deliver'));
  for (const index of [0, 1, 2, 3]) {
    const item = buildPilotCase(index);
    assert.ok(item.input.includes(JSON.stringify(item.observation)));
    const grade = gradeResponse(JSON.stringify(item.answer), item.seed, item.arm);
    assert.equal(grade.valid, true);
    assert.equal(grade.exact, true, JSON.stringify(grade.fields));
    const noAction = gradeResponse('{}', item.seed, item.arm);
    assert.equal(noAction.valid, true);
    assert.equal(noAction.exact, false);
  }
  const early = buildPilotCase(0).observation;
  const late = buildPilotCase(2).observation;
  const normalized = structuredClone(early);
  normalized.assignment_revision.effective_at = late.assignment_revision.effective_at;
  assert.deepEqual(normalized, late);
});

test('well-formed wrong actions are valid failures; malformed schema is invalid', () => {
  const early = buildPilotCase(0);
  const missingIncident = {
    ...early.answer,
    record_exposure_receipt_ids: [],
  };
  assert.equal(gradeResponse(JSON.stringify(missingIncident), early.seed, early.arm).valid, true);
  assert.equal(gradeResponse(JSON.stringify(missingIncident), early.seed, early.arm).exact, false);
  const late = buildPilotCase(1);
  const falseIncident = {
    ...late.answer,
    record_exposure_receipt_ids: [late.observation.prior_recipient_receipts[0].receipt_id],
  };
  assert.equal(gradeResponse(JSON.stringify(falseIncident), late.seed, late.arm).valid, true);
  assert.equal(gradeResponse(JSON.stringify(falseIncident), late.seed, late.arm).exact, false);
  const wrongPending = {
    ...late.answer,
    release_pending_ids: ['neighbor-delivery-id'],
  };
  assert.equal(gradeResponse(JSON.stringify(wrongPending), late.seed, late.arm).valid, true);
  assert.equal(gradeResponse(JSON.stringify(wrongPending), late.seed, late.arm).exact, false);
  assert.deepEqual(gradeResponse('not json', late.seed, late.arm), {
    valid: false,
    reason: 'non-json-response',
  });
  assert.equal(gradeResponse('{"release_pending_ids":true}', late.seed, late.arm).valid, false);
  assert.equal(gradeResponse('{"secret_expected_arm":"late"}', late.seed, late.arm).valid, false);
});

test('equivalent scoped hold and release choices are credited by terminal effects', () => {
  const late = buildPilotCase(1);
  const cId = late.observation.pending_chunks.find((chunk) => chunk.account_id === 'acct-C').delivery_id;
  const equivalent = { hold_pending_ids: [cId] };
  const grade = gradeResponse(JSON.stringify(equivalent), late.seed, late.arm);
  assert.equal(grade.valid, true);
  assert.equal(grade.exact, true, JSON.stringify(grade.fields));
});
