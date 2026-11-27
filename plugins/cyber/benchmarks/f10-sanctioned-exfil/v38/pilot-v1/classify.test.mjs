import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRun } from './classify.mjs';

test('well-formed wrong worker is a valid task failure', () => {
  const grade = { exact: false };
  assert.deepEqual(classifyRun(0, { complete: true }, { sound: true }, grade), {
    status: 'valid',
    grade,
  });
});

test('conduct, incomplete transport and provider errors stay distinct', () => {
  assert.equal(
    classifyRun(0, { complete: true }, { sound: false, reason: 'other-file' }, null).status,
    'valid-conduct-failure',
  );
  assert.equal(
    classifyRun(0, { complete: false }, { sound: true }, null).status,
    'harness-or-transport-error',
  );
  assert.equal(
    classifyRun(1, { complete: false }, { sound: true }, null).status,
    'provider-or-cli-error',
  );
});
