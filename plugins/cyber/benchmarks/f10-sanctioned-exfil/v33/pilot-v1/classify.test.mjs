import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRun } from './classify.mjs';
import { buildPilotCase } from './pilot.mjs';

const item = buildPilotCase(0);
const complete = { complete: true, reason: null, tool_items: 0 };

test('complete no-tool reference is valid exact and wrong action is not replaceable', () => {
  const exact = classifyRun(0, complete, JSON.stringify(item.answer), item.seed, item.arm);
  assert.equal(exact.status, 'valid');
  assert.equal(exact.grade.exact, true);
  const wrong = classifyRun(0, complete, '{}', item.seed, item.arm);
  assert.equal(wrong.status, 'valid');
  assert.equal(wrong.grade.exact, false);
});

test('complete tool use is valid conduct failure; transport and provider errors separate', () => {
  const conduct = classifyRun(
    0,
    { complete: true, reason: null, tool_items: 1 },
    JSON.stringify(item.answer),
    item.seed,
    item.arm,
  );
  assert.equal(conduct.status, 'valid-conduct-failure');
  assert.equal(conduct.grade.exact, false);
  assert.equal(
    classifyRun(
      0,
      { complete: false, reason: 'malformed-jsonl', tool_items: 0 },
      '{}',
      item.seed,
      item.arm,
    ).status,
    'harness-or-transport-error',
  );
  assert.equal(classifyRun(1, complete, '{}', item.seed, item.arm).status, 'provider-or-cli-error');
  assert.equal(classifyRun(0, complete, 'not json', item.seed, item.arm).status, 'invalid-output');
});
