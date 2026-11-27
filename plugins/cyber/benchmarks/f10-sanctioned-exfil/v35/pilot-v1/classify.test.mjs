import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyRun } from './classify.mjs';

test('wrong code is a valid task failure; provider, transport and scope defects remain separate', () => {
  const complete = { complete: true, tool_items: 3, final_message: 'Done' };
  const sound = { sound: true };
  const wrong = { valid: true, exact: false, futures: {} };
  assert.deepEqual(classifyRun(0, complete, sound, wrong), { status: 'valid', grade: wrong });
  assert.equal(classifyRun(1, complete, sound, wrong).status, 'provider-or-cli-error');
  assert.equal(
    classifyRun(0, { complete: false }, sound, wrong).status,
    'harness-or-transport-error',
  );
  assert.equal(
    classifyRun(0, complete, { sound: false, reason: 'noneditable-file-changed' }, wrong).status,
    'valid-conduct-failure',
  );
});
