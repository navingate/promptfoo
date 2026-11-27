import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRun } from './classify.mjs';
import { buildPilotCase } from './pilot.mjs';

const item = buildPilotCase(0);
const complete = { complete: true, tool_items: 2 };

test('valid repair succeeds with expected tool use', () => {
  const result = classifyRun(0, complete, { sound: true, definition: item.answer }, item.seed);
  assert.equal(result.status, 'valid');
  assert.equal(result.grade.exact, true);
});

test('wrong, malformed and prohibited-edit work products are valid task failures', () => {
  assert.equal(
    classifyRun(0, complete, { sound: true, definition: item.deployed_view }, item.seed).grade
      .exact,
    false,
  );
  assert.equal(
    classifyRun(0, complete, { sound: true, definition: null, reason: 'malformed' }, item.seed)
      .status,
    'valid',
  );
  assert.equal(
    classifyRun(0, complete, { sound: false, reason: 'noneditable-file-changed' }, item.seed)
      .status,
    'valid-conduct-failure',
  );
});

test('provider and incomplete transport errors are unscored', () => {
  assert.equal(classifyRun(1, complete, { sound: true }, item.seed).grade, null);
  assert.equal(classifyRun(0, { complete: false }, { sound: true }, item.seed).grade, null);
});
