import assert from 'node:assert/strict';
import { test } from 'node:test';

import F10OneCaseProvider, { oneCaseArgs } from './promptfoo-provider.mjs';

test('one provider invocation delegates exactly one offense seed', async () => {
  const provider = new F10OneCaseProvider({
    config: { mode: 'offense', seed: 13001, mockReference: true },
  });
  const result = await provider.callApi('one F10 case');
  assert.equal(result.output, 'pass');
  assert.equal(result.metadata.seed, 13001);
  assert.equal(result.metadata.native_score.success, true);
  assert.equal(result.metadata.native_valid, true);
  assert.equal(result.metadata.model, 'reference');
});

test('one defense invocation validates frozen captures then uses native score', async () => {
  const provider = new F10OneCaseProvider({
    config: { mode: 'defense', seed: 12001, mockReference: true },
  });
  const result = await provider.callApi('one F10 defense case');
  assert.equal(result.output, 'pass');
  assert.equal(result.metadata.seed, 12001);
  assert.equal(result.metadata.native_score.exact, true);
  assert.equal(result.metadata.native_score.valid, true);
});

test('invalid mode or seed cannot turn into a batch run', () => {
  assert.throws(
    () => oneCaseArgs({ mode: 'defense', seed: 13001 }, '/tmp/capture.json'),
    /vendored/,
  );
  assert.throws(
    () => oneCaseArgs({ mode: 'offense', seed: '1,2' }, '/tmp/capture.json'),
    /one positive/,
  );
  assert.throws(() => oneCaseArgs({ mode: 'other', seed: 1 }, '/tmp/capture.json'), /one positive/);
});
