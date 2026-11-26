import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceCase } from '../v16/holdout-producer.mjs';
import { detect } from './reference.mjs';

test('visible-only reference distinguishes a covered actor from an unbound overlap', () => {
  const { visible } = produceCase(41001, 'covered-overlap', {
    nonce: 'v17-visible',
    captureNonce: 'v17-visible-overlap',
  });
  assert.deepEqual(Object.values(detect(visible)), ['sanctioned-bulk', 'benign']);
});

test('visible-only reference treats a dangling cite in a complete registry as unbound', () => {
  const { visible } = produceCase(41001, 'dangling-citation', {
    nonce: 'v17-visible',
    captureNonce: 'v17-visible-dangling',
  });
  assert.deepEqual(Object.values(detect(visible)), ['benign']);
});
