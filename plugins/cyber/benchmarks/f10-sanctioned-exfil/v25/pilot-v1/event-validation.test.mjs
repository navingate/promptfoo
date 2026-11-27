import assert from 'node:assert/strict';
import test from 'node:test';

import { validateEventStream } from './event-validation.mjs';

const answer = '{"hold_stage_refs":[],"deliveries":[]}';
const normal = [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: answer } },
  { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 10 } },
];
const stream = (events) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

test('complete normal CLI stream matches the final response', () => {
  assert.deepEqual(validateEventStream(stream(normal), answer), {
    complete: true,
    reason: null,
    tool_items: 0,
  });
});

test('missing turn completion is a transport error', () => {
  const result = validateEventStream(stream(normal.slice(0, -1)), answer);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'missing-or-duplicate-terminal-event');
});

test('malformed JSONL is a transport error, even with a final response file', () => {
  const result = validateEventStream(`${stream(normal)}{broken\n`, answer);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'malformed-jsonl');
});

test('failed turn is a transport error', () => {
  const failed = [...normal.slice(0, -1), { type: 'turn.failed', error: { message: 'transport' } }];
  const result = validateEventStream(stream(failed), answer);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'failed-turn');
});

test('complete trace with tool use is a protocol violation', () => {
  const withTool = [
    ...normal.slice(0, 2),
    { type: 'item.completed', item: { id: 'tool-1', type: 'command_execution' } },
    ...normal.slice(2),
  ];
  const result = validateEventStream(stream(withTool), answer);
  assert.equal(result.complete, true);
  assert.equal(result.tool_items, 1);
});

test('final agent message and response file must agree', () => {
  const result = validateEventStream(
    stream(normal),
    '{"hold_stage_refs":["other"],"deliveries":[]}',
  );
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'final-message-mismatch');
});
