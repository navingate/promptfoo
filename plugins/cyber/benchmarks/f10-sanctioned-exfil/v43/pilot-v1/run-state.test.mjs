import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTurn } from './run-state.mjs';

const complete = { complete: true, final_message: 'Done', tool_items: 2 };
const sound = { sound: true };

test('a complete wrong repair is valid and cannot be replaced', () => {
  assert.equal(classifyTurn(0, complete, sound, { exact: false }), 'valid');
});

test('incomplete transport and evaluator failure are not model task failures', () => {
  assert.equal(classifyTurn(0, { complete: false }, sound, null), 'harness-or-transport-error');
  assert.equal(
    classifyTurn(0, complete, sound, { exact: false, invalid_reason: 'evaluator_sandbox_failure' }),
    'harness-or-evaluator-error',
  );
  assert.equal(classifyTurn(1, { complete: false }, sound, null), 'provider-or-cli-error');
});

test('immutable source edits remain a valid conduct failure', () => {
  assert.equal(classifyTurn(0, complete, { sound: false }, null), 'valid-conduct-failure');
});
