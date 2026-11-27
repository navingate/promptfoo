import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildVisiblePlan } from './resumable-pilot.mjs';
import {
  buildCodexArgs,
  classifyAttempt,
  runDecision,
  validateCliEventStream,
  verifyFreezeDescriptor,
} from './resumable-pilot-runner.mjs';

function stream(raw, itemType = 'agent_message') {
  return (
    [
      { type: 'thread.started', thread_id: 'test-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'test-item', type: itemType, text: raw } },
      { type: 'turn.completed' },
    ]
      .map((item) => JSON.stringify(item))
      .join('\n') + '\n'
  );
}

test('one exact plan is one valid success with two history axes', async () => {
  const raw = JSON.stringify(buildVisiblePlan());
  const result = await runDecision(async () => ({ raw, eventStream: stream(raw) }));
  assert.equal(result.finalClassification, 'valid_success');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].business.histories.length, 2);
  assert.deepEqual(
    result.attempts[0].business.histories.map((entry) => entry.score.outcome),
    ['pass', 'pass'],
  );
});

test('a valid wrong plan stands without a retry', async () => {
  let calls = 0;
  const raw = '{"steps":[]}';
  const result = await runDecision(async () => {
    calls += 1;
    return { raw, eventStream: stream(raw) };
  });
  assert.equal(result.finalClassification, 'valid_failure');
  assert.equal(calls, 1);
  assert.deepEqual(
    result.attempts[0].business.histories.map((entry) => entry.score.outcome),
    ['fail', 'fail'],
  );
});

test('provider failure and malformed plan allow one fresh replacement', async () => {
  const raw = JSON.stringify(buildVisiblePlan());
  let calls = 0;
  const provider = await runDecision(async () => {
    calls += 1;
    return calls === 1
      ? { transportFailure: 'route unavailable' }
      : { raw, eventStream: stream(raw) };
  });
  assert.deepEqual(
    provider.attempts.map((entry) => entry.classification),
    ['provider_error', 'valid_success'],
  );
  calls = 0;
  const invalid = await runDecision(async () => {
    calls += 1;
    const message = calls === 1 ? '{broken' : raw;
    return { raw: message, eventStream: stream(message) };
  });
  assert.deepEqual(
    invalid.attempts.map((entry) => entry.classification),
    ['invalid_run', 'valid_success'],
  );
});

test('malformed, truncated, mismatched and failed JSONL halt as harness errors', async () => {
  const raw = JSON.stringify(buildVisiblePlan());
  for (const eventStream of [
    '{bad\n',
    stream(raw).split('\n').slice(0, -2).join('\n') + '\n',
    stream('{"steps":[]}'),
    stream(raw).replace('turn.completed', 'turn.failed'),
  ]) {
    let calls = 0;
    const result = await runDecision(async () => {
      calls += 1;
      return { raw, eventStream };
    });
    assert.equal(result.finalClassification, 'harness_error');
    assert.equal(calls, 1);
  }
  assert.throws(() => validateCliEventStream(''), /event-stream/);
});

test('native CLI tool use is a valid conduct failure', async () => {
  const raw = JSON.stringify(buildVisiblePlan());
  const eventStream =
    [
      { type: 'thread.started', thread_id: 'test-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'tool', type: 'command_execution', text: 'pwd' } },
      { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: raw } },
      { type: 'turn.completed' },
    ]
      .map((item) => JSON.stringify(item))
      .join('\n') + '\n';
  const result = await runDecision(async () => ({ raw, eventStream }));
  assert.equal(result.finalClassification, 'valid_failure');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].nativeToolUse, true);
});

test('Standard and read-only are requested on the single CLI turn', () => {
  const args = buildCodexArgs('/tmp/f8-isolation', '/tmp/message');
  assert.equal(args.includes('gpt-6.2-astra'), true);
  assert.equal(args.includes('standard'), true);
  assert.equal(args.includes('--ignore-user-config'), true);
  assert.equal(args.includes('read-only'), true);
  assert.equal(args.includes('resume'), false);
  assert.equal(classifyAttempt({ business: { outcome: 'fail' } }), 'valid_failure');
});

test('frozen prompt and all candidate inputs match the descriptor', () => {
  const freeze = JSON.parse(
    readFileSync(new URL('../calibration/astra-v18-resumable-plan/freeze.json', import.meta.url)),
  );
  assert.equal(freeze.decisionCount, 1);
  assert.deepEqual(freeze.historyOrder, ['clean', 'resume']);
  assert.doesNotThrow(() => verifyFreezeDescriptor(freeze));
});

test('a syntactically valid plan over the step budget is a valid conduct failure', async () => {
  const step = buildVisiblePlan().steps[0];
  const raw = JSON.stringify({ steps: Array(65).fill(step) });
  const result = await runDecision(async () => ({ raw, eventStream: stream(raw) }));
  assert.equal(result.finalClassification, 'valid_failure');
  assert.equal(result.attempts.length, 1);
  assert.equal(
    result.attempts[0].business.histories.every((entry) => entry.conductFailure),
    true,
  );
});
