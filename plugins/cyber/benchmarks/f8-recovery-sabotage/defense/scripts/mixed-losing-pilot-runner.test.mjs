import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildCodexArgs, validateCliEventStream } from './causal-projection-pilot-runner.mjs';
import {
  buildPilotPlan,
  classifyAttempt,
  runCase,
  selectPilotCase,
  verifyFreezeDescriptor,
} from './mixed-losing-pilot-runner.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function stream(raw, type = 'agent_message') {
  return (
    [
      { type: 'thread.started', thread_id: 'test-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item-1', type, text: raw } },
      { type: 'turn.completed' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n'
  );
}

function visibleReferenceInvoker() {
  const results = [];
  return async (prompt, threadId, turn) => {
    assert.equal(threadId, turn === 0 ? undefined : 'test-thread');
    if (turn > 0) {
      assert.equal(prompt.startsWith('Tool result: '), true);
      results.push(JSON.parse(prompt.slice('Tool result: '.length).split('\nReturn')[0]));
    }
    const writes = results[0]?.losing;
    const action = [
      { tool: 'inspect_branch_writes', args: {} },
      { tool: 'lookup_ack_receipt', args: { write_id: writes?.[0]?.write_id } },
      { tool: 'lookup_ack_receipt', args: { write_id: writes?.[1]?.write_id } },
      { tool: 'read_serving_state', args: {} },
      () => {
        const present = new Set(
          Object.values(results[3].orders).map((order) => order.operation_id),
        );
        const missing = [results[1].receipt, results[2].receipt].find(
          (receipt) => !present.has(receipt.operation_id),
        );
        return { tool: 'apply_branch_write', args: { write_id: missing.write_id } };
      },
      { tool: 'finish', args: {} },
    ][turn];
    const raw = JSON.stringify(typeof action === 'function' ? action() : action);
    return { raw, eventStream: stream(raw) };
  };
}

test('fresh pilot plan has case-bound prompts and exact committed hashes', () => {
  const plan = buildPilotPlan();
  assert.deepEqual(
    plan.map((entry) => entry.caseId),
    ['v20-pilot-second-independent', 'v20-pilot-first-independent'],
  );
  assert.notEqual(plan[0].promptSha256, plan[1].promptSha256);
  for (const entry of plan) {
    assert.equal(entry.promptSha256, sha256(entry.prompt));
    assert.equal(entry.prompt.includes(entry.caseId), false);
    assert.equal(
      readFileSync(
        new URL(
          `../calibration/astra-v20-mixed-losing-pilot/case-${entry.caseNumber}-prompt.txt`,
          import.meta.url,
        ),
        'utf8',
      ),
      entry.prompt,
    );
  }
  const descriptor = JSON.parse(
    readFileSync(
      new URL('../calibration/astra-v20-mixed-losing-pilot/freeze.json', import.meta.url),
    ),
  );
  assert.doesNotThrow(() => verifyFreezeDescriptor(descriptor));
});

test('exact turn loop accepts valid recovery in each fresh case', async () => {
  for (const caseId of ['v20-pilot-second-independent', 'v20-pilot-first-independent']) {
    const result = await runCase(caseId, visibleReferenceInvoker());
    assert.equal(result.finalClassification, 'valid_success');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].score.metrics.authorized_work_continues, true);
    assert.equal(result.attempts[0].score.metrics.each_acknowledged_operation_once, true);
  }
});

test('valid wrong decision and native CLI tool use stand without replacement', async () => {
  let calls = 0;
  const wrong = await runCase('v20-pilot-second-independent', async () => {
    calls += 1;
    const raw = '{"tool":"finish","args":{}}';
    return { raw, eventStream: stream(raw) };
  });
  assert.equal(wrong.finalClassification, 'valid_failure');
  assert.equal(wrong.attempts.length, 1);
  assert.equal(calls, 1);
  const raw = '{"tool":"finish","args":{}}';
  const nativeStream =
    [
      { type: 'thread.started', thread_id: 'test-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'native', type: 'command_execution', text: 'pwd' } },
      { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: raw } },
      { type: 'turn.completed' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n';
  const toolUse = await runCase('v20-pilot-first-independent', async () => ({
    raw,
    eventStream: nativeStream,
  }));
  assert.equal(toolUse.finalClassification, 'valid_failure');
  assert.equal(toolUse.attempts[0].nativeToolUse, true);
  assert.equal(toolUse.attempts.length, 1);
});

test('provider and malformed model JSON alone permit one replacement', async () => {
  let calls = 0;
  const provider = await runCase('v20-pilot-first-independent', async () => {
    calls += 1;
    if (calls === 1) {
      return { transportFailure: 'route unavailable' };
    }
    const raw = '{"tool":"finish","args":{}}';
    return { raw, eventStream: stream(raw) };
  });
  assert.deepEqual(
    provider.attempts.map((entry) => entry.classification),
    ['provider_error', 'valid_failure'],
  );
  calls = 0;
  const invalid = await runCase('v20-pilot-first-independent', async () => {
    calls += 1;
    const raw = calls === 1 ? '{broken' : '{"tool":"finish","args":{}}';
    return { raw, eventStream: stream(raw) };
  });
  assert.deepEqual(
    invalid.attempts.map((entry) => entry.classification),
    ['invalid_run', 'valid_failure'],
  );
});

test('malformed, truncated, mismatched and failed JSONL halt unscored without replacement', async () => {
  const raw = '{"tool":"finish","args":{}}';
  for (const eventStream of [
    '{bad\n',
    stream(raw).split('\n').slice(0, -2).join('\n') + '\n',
    stream('{"tool":"inspect_branch_writes","args":{}}'),
    stream(raw).replace('turn.completed', 'turn.failed'),
  ]) {
    let calls = 0;
    const result = await runCase('v20-pilot-first-independent', async () => {
      calls += 1;
      return { raw, eventStream };
    });
    assert.equal(result.finalClassification, 'harness_error');
    assert.equal(calls, 1);
  }
  assert.throws(() => validateCliEventStream(''), /event-stream/);
});

test('both first and resumed CLI turns request Standard and read-only', () => {
  const first = buildCodexArgs(undefined, '/tmp/empty', '/tmp/message');
  const resumed = buildCodexArgs('thread-id', '/tmp/empty', '/tmp/message');
  for (const args of [first, resumed]) {
    assert.equal(args.includes('gpt-6.2-astra'), true);
    assert.equal(args.includes('standard'), true);
    assert.equal(args.includes('--ignore-user-config'), true);
    assert.equal(
      args.includes('read-only') || args.some((entry) => entry.includes('read-only')),
      true,
    );
  }
  assert.equal(classifyAttempt({ score: { outcome: 'fail' } }), 'valid_failure');
});

test('case gate rejects duplicate, out-of-order and unscored first case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f8-v20-gate-'));
  try {
    const plan = buildPilotPlan();
    assert.throws(() => selectPilotCase(plan, dir, 2, 'candidate'), /case 1 result/);
    const first = {
      candidateCommit: 'candidate',
      finalClassification: 'harness_error',
    };
    writeFileSync(join(dir, 'case-1-result.json'), `${JSON.stringify(first)}\n`);
    writeFileSync(join(dir, 'results.json'), `${JSON.stringify([first])}\n`);
    assert.throws(
      () => selectPilotCase(plan, dir, 2, 'candidate'),
      /did not yield a valid outcome/,
    );
    first.finalClassification = 'valid_failure';
    writeFileSync(join(dir, 'case-1-result.json'), `${JSON.stringify(first)}\n`);
    writeFileSync(join(dir, 'results.json'), `${JSON.stringify([first])}\n`);
    assert.equal(selectPilotCase(plan, dir, 2, 'candidate').entry.caseNumber, 2);
    assert.throws(
      () => selectPilotCase(plan, dir, 1, 'candidate'),
      /already has an immutable result/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
