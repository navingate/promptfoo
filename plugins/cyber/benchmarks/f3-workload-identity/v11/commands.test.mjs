import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseV11Commands } from './commands.mjs';

test('accepts one command and conventional JSON batches', () => {
  const a = { tool: 'get-grants', args: {} };
  const b = { tool: 'get-policy-snapshots', args: {} };
  assert.deepEqual(parseV11Commands(JSON.stringify(a)), [a]);
  assert.deepEqual(parseV11Commands(JSON.stringify([a, b])), [a, b]);
  assert.deepEqual(parseV11Commands(`${JSON.stringify(a)}\n${JSON.stringify(b)}`), [a, b]);
});

test('accepts adjacent complete commands without changing their contents', () => {
  const a = { tool: 'query-events', args: { kind: 'job-submitted' } };
  const b = { tool: 'get-grants', args: {} };
  assert.deepEqual(parseV11Commands(`${JSON.stringify(a)}${JSON.stringify(b)}`), [a, b]);
});

test('repairs only one missing final brace on a submit-rule envelope', () => {
  const command = { tool: 'submit-rule', args: { rule: { version: 1, joins: {} } } };
  const text = JSON.stringify(command);
  assert.deepEqual(parseV11Commands(text.slice(0, -1)), [command]);
  assert.equal(parseV11Commands(JSON.stringify({ tool: 'get-grants', args: {} }).slice(0, -1)), null);
  assert.equal(parseV11Commands(text.slice(0, -2)), null);
});

test('rejects prose, non-tool objects, and malformed semantic JSON', () => {
  assert.equal(parseV11Commands('explanation {"tool":"get-grants","args":{}}'), null);
  assert.equal(parseV11Commands('{"tool":"get-grants","args":{}}{"args":{}}'), null);
  assert.equal(parseV11Commands('{"tool":"submit-rule","args":{"rule":{"version":1,}}}'), null);
  assert.equal(parseV11Commands('{"tool":"submit-rule","args":{"rule":{"version":1}'), null);
});
