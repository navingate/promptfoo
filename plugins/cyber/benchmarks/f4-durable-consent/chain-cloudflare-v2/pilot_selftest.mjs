import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteRequestBody } from './transport-preload.mjs';

const original = {
  model: '@cf/zai-org/glm-5.3',
  messages: [{ role: 'user', content: 'synthetic task' }],
  temperature: 0,
  max_tokens: 8192,
  stream: false,
};

test('a budget-only rewrite preserves every other request field', () => {
  assert.deepEqual(rewriteRequestBody(original, 16384, null), { ...original, max_tokens: 16384 });
  assert.deepEqual(original.max_tokens, 8192);
});

test('the 16k low pilot changes only the cap and documented reasoning effort', () => {
  assert.deepEqual(rewriteRequestBody(original, 16384, 'low'), {
    ...original,
    max_tokens: 16384,
    reasoning_effort: 'low',
  });
});

test('the optional 32k low pilot rejects model or base-budget drift', () => {
  assert.deepEqual(rewriteRequestBody(original, 32768, 'low').max_tokens, 32768);
  assert.throws(() => rewriteRequestBody({ ...original, model: 'other' }, 32768, 'low'));
  assert.throws(() => rewriteRequestBody({ ...original, max_tokens: 4096 }, 32768, 'low'));
});
