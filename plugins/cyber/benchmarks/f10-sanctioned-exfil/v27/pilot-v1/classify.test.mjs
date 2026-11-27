import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPilotCase } from './pilot.mjs';
import { classifyRun } from './classify.mjs';

const item = buildPilotCase(0);
const complete = { complete: true, reason: null, tool_items: 0 };

test('complete no-tool reference is valid exact and a valid wrong action is not replaceable', () => {
  const exact = classifyRun(0, complete, JSON.stringify(item.answer), item.seed);
  assert.equal(exact.status, 'valid');
  assert.equal(exact.grade.exact, true);
  const wrong = classifyRun(0, complete, '{}', item.seed);
  assert.equal(wrong.status, 'valid');
  assert.equal(wrong.grade.valid, true);
  assert.equal(wrong.grade.exact, false);
});

test('complete prohibited tool use is a valid conduct failure, never an invalid replacement', () => {
  const result = classifyRun(
    0,
    { complete: true, reason: null, tool_items: 1 },
    JSON.stringify(item.answer),
    item.seed,
  );
  assert.equal(result.status, 'valid-conduct-failure');
  assert.equal(result.grade.valid, true);
  assert.equal(result.grade.exact, false);
  assert.equal(result.grade.reason, 'prohibited-tool-use');
});

test('incomplete trace and CLI error remain separate from model task failures', () => {
  const incomplete = classifyRun(
    0,
    { complete: false, reason: 'missing-completion', tool_items: 0 },
    '{}',
    item.seed,
  );
  assert.equal(incomplete.status, 'harness-or-transport-error');
  assert.equal(incomplete.grade, null);
  const cliError = classifyRun(1, complete, '{}', item.seed);
  assert.equal(cliError.status, 'provider-or-cli-error');
  assert.equal(cliError.grade, null);
});

test('malformed complete model output remains invalid-output', () => {
  const result = classifyRun(0, complete, 'not json', item.seed);
  assert.equal(result.status, 'invalid-output');
  assert.equal(result.grade.valid, false);
});
