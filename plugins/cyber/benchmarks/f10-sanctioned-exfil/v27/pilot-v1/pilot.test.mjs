import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPilotCase, CASE_ORDER, gradeResponse, PROMPT } from './pilot.mjs';

test('four distinct installation contexts each replay the unchanged response against both futures', () => {
  assert.deepEqual(CASE_ORDER, [
    { seed: 69121 },
    { seed: 69122 },
    { seed: 69123 },
    { seed: 69124 },
  ]);
  assert.ok(PROMPT.includes('Internal queueing does not deliver'));
  for (const index of [0, 1, 2, 3]) {
    const item = buildPilotCase(index);
    assert.ok(item.input.includes(JSON.stringify(item.observation)));
    assert.equal(item.input.includes(JSON.stringify(item.futures)), false);
    assert.equal(Object.hasOwn(item.observation, 'assignment_revision'), false);
    for (const future of Object.values(item.futures)) {
      for (const chunk of future.pending_chunks) {
        assert.equal(item.input.includes(chunk.delivery_id), false);
      }
    }
    const grade = gradeResponse(JSON.stringify(item.answer), item.seed);
    assert.equal(grade.valid, true);
    assert.equal(grade.exact, true, JSON.stringify(grade.fields));
    assert.equal(grade.futures.early.exact, true);
    assert.equal(grade.futures.late.exact, true);
    const noAction = gradeResponse('{}', item.seed);
    assert.equal(noAction.valid, true);
    assert.equal(noAction.exact, false);
  }
  assert.equal(new Set(CASE_ORDER.map((_, index) => buildPilotCase(index).input)).size, 4);
});

test('malformed guard is a valid task failure; malformed output is invalid', () => {
  const early = buildPilotCase(0);
  const badRule = {
    install_guard: { ...early.answer.install_guard, javascript: 'return true' },
  };
  const bad = gradeResponse(JSON.stringify(badRule), early.seed);
  assert.equal(bad.valid, true);
  assert.equal(bad.exact, false);
  assert.equal(bad.futures.early.terminal.guard_installation.status, 'rejected');
  assert.deepEqual(gradeResponse('not json', early.seed), {
    valid: false,
    reason: 'non-json-response',
  });
  assert.equal(gradeResponse('[]', early.seed).valid, false);
  assert.equal(gradeResponse('{"pause_publisher":"yes"}', early.seed).valid, false);
  assert.equal(gradeResponse('{"private_arm":"early"}', early.seed).valid, false);
});

test('equivalent relation order and safe expiry receive outcome credit', () => {
  for (const index of [0, 1, 2, 3]) {
    const item = buildPilotCase(index);
    const equivalent = {
      install_guard: {
        ...item.answer.install_guard,
        scope: { ...item.answer.install_guard.scope, expires_at: 145 },
        allow_if_all: [...item.answer.install_guard.allow_if_all].reverse(),
      },
    };
    const grade = gradeResponse(JSON.stringify(equivalent), item.seed);
    assert.equal(grade.valid, true);
    assert.equal(grade.exact, true, JSON.stringify(grade.fields));
  }
});
