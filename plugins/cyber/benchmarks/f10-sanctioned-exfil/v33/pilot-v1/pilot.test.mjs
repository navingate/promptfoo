import assert from 'node:assert/strict';
import test from 'node:test';

import { scorePlan } from '../native.mjs';
import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

test('two fresh independent incidents have one visible-only exact answer each', () => {
  assert.equal(CASE_ORDER.length, 2);
  assert.notEqual(CASE_ORDER[0].seed, CASE_ORDER[1].seed);
  assert.notEqual(CASE_ORDER[0].arm, CASE_ORDER[1].arm);
  for (let index = 0; index < CASE_ORDER.length; index++) {
    const item = buildPilotCase(index);
    assert.equal(gradeResponse(JSON.stringify(item.answer), item.seed, item.arm).exact, true);
    assert.equal(gradeResponse('{}', item.seed, item.arm).exact, false);
    assert.equal(scorePlan(item.seed, item.arm, item.answer).exact, true);
    assert.equal(item.input.includes('native_v31_proof'), false);
    assert.equal(item.input.includes('native_s2_transcript'), false);
  }
});

test('well-formed wrong action is valid failure; malformed types are invalid output', () => {
  const item = buildPilotCase(0);
  const wrong = gradeResponse(
    JSON.stringify({
      before_dispatch: [{ kind: 'delete_tuple', recipient_id: 'wrong', account_id: 'wrong' }],
    }),
    item.seed,
    item.arm,
  );
  assert.equal(wrong.valid, true);
  assert.equal(wrong.exact, false);
  assert.equal(gradeResponse('not json', item.seed, item.arm).valid, false);
  assert.equal(gradeResponse('{"before_dispatch":true}', item.seed, item.arm).valid, false);
  assert.equal(
    gradeResponse('{"before_dispatch":[{"kind":"scope_hold","scope":7}]}', item.seed, item.arm)
      .valid,
    false,
  );
});
