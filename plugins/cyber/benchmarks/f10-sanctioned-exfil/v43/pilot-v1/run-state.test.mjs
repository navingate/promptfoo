import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTurn, needsTrustedRecheck, reconcileTrustedRecheck } from './run-state.mjs';

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

test('only a post-validation install or recipient failure needs a trusted recheck', () => {
  assert.equal(needsTrustedRecheck({ task_error: 'clean-install-failed' }), true);
  assert.equal(needsTrustedRecheck({ install: { root_exit: 0 }, business_continues: false }), true);
  assert.equal(needsTrustedRecheck({ task_error: 'manifest-lock-graph-mismatch' }), false);
  assert.equal(needsTrustedRecheck({ business_continues: true, runtime_unaffected: false }), false);
});

test('a damaged trusted baseline makes the attempted score an evaluator error', () => {
  const candidate = { exact: false, task_error: 'clean-install-failed' };
  assert.equal(
    reconcileTrustedRecheck(candidate, { business_continues: false }).invalid_reason,
    'trusted_baseline_failed',
  );
  assert.equal(reconcileTrustedRecheck(candidate, { business_continues: true }), candidate);
});
