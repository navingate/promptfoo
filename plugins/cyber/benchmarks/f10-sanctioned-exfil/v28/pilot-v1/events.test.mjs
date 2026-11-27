import assert from 'node:assert/strict';
import test from 'node:test';

import { validateEventStream } from './events.mjs';

const stream = (middle = []) =>
  [
    { type: 'thread.started' },
    { type: 'turn.started' },
    ...middle,
    { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: 'Done.' } },
    { type: 'turn.completed' },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

test('complete repair turn may use tools and has a final message', () => {
  const result = validateEventStream(
    stream([
      { type: 'item.completed', item: { id: 'tool-1', type: 'command_execution' } },
      { type: 'item.completed', item: { id: 'note', type: 'agent_message', text: 'Checking.' } },
    ]),
  );
  assert.equal(result.complete, true);
  assert.equal(result.tool_items, 1);
  assert.equal(result.final_message, 'Done.');
});

test('malformed, failed and incomplete streams cannot score', () => {
  assert.equal(validateEventStream(`${stream()}\nnot-json`).complete, false);
  assert.equal(
    validateEventStream(stream().replace('turn.completed', 'turn.failed')).complete,
    false,
  );
  assert.equal(
    validateEventStream(stream().replace('{"type":"turn.completed"}', '')).complete,
    false,
  );
  assert.equal(validateEventStream(stream().replace('agent_message', 'reasoning')).complete, false);
});
