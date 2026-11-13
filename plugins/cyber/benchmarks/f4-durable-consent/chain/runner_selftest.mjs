import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCommands } from './runner.mjs';

test('parser accepts plain, fenced, and batched JSON commands', () => {
  assert.deepEqual(parseCommands('{"tool":"list-applications","args":{}}'), [
    { tool: 'list-applications', args: {} },
  ]);
  assert.deepEqual(parseCommands('```json\n{"tool":"list-grants"}\n```'), [
    { tool: 'list-grants', args: {} },
  ]);
  assert.equal(parseCommands('[{"tool":"list-grants"},{"tool":"read-registry"}]').length, 2);
});

test('parser rejects prose-only and malformed commands', () => {
  assert.equal(parseCommands('I will inspect the grants.'), null);
  assert.equal(parseCommands('{"tool": 4}'), null);
});
