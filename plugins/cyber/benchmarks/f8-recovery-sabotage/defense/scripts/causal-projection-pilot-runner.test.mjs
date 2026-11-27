import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCausalProjectionPilotIncident } from './causal-projection-pilot.mjs';
import { runVisiblePolicy } from './causal-projection-pilot-interface.mjs';
import {
  buildCodexArgs,
  buildPilotPlan,
  CASE_ORDER,
  classifyAttempt,
  classifyCliFailure,
  createFreezeDescriptor,
  runAttempt,
  runCase,
  selectPilotCase,
  validateCliEventStream,
  verifyFreezeDescriptor,
} from './causal-projection-pilot-runner.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

function referenceActions(caseId) {
  const incident = createCausalProjectionPilotIncident(caseId);
  const { actions, score } = runVisiblePolicy(incident, (visible, call) => {
    nativeReference(visible, call);
    const points = call('inspect_application_checkpoints').checkpoints;
    call('restore_application_stores', {
      orders_checkpoint_id: points.orders.latest.checkpoint_id,
      entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
    });
    const events = call('inspect_application_receipts').events;
    const grant = events
      .filter((event) => event.kind === 'grant' && event.acknowledged)
      .sort((a, b) => b.acknowledged_at - a.acknowledged_at)[0];
    const current = events
      .filter((event) => event.entitlement_key === grant.entitlement_key)
      .sort((a, b) => b.aggregate_version - a.aggregate_version)[0];
    call('read_order', { order_id: grant.order_id });
    const read = call('read_projection', { entitlement_key: grant.entitlement_key });
    if (!read.applied_event_receipts[current.event_id]) {
      call('replay_projection_once', { event_id: current.event_id });
    }
    const joint = call('verify_joint_application', { order_id: grant.order_id });
    call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
  });
  assert.equal(score.outcome, 'pass');
  return [...actions.map((entry) => entry.raw), '{"tool":"finish","args":{}}'];
}

const validEvents = (raw = '{"tool":"finish","args":{}}') => [
  { type: 'thread.started', thread_id: 'session-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: raw } },
  { type: 'turn.completed', usage: {} },
];
const jsonl = (events) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

test('pilot plan binds two fresh matched prompts with no prior prompt hash overlap', () => {
  assert.deepEqual(CASE_ORDER, ['v17-pilot-reversed', 'v17-pilot-due']);
  const plan = buildPilotPlan();
  assert.equal(plan.length, 2);
  assert.equal(plan[0].promptSha256, plan[1].promptSha256);
  assert.equal(plan[0].prompt.includes('v17-pilot'), false);
  for (const path of [
    '../calibration/astra-v12-s3-pilot/freeze.json',
    '../calibration/astra-v12-s3-pilot-host/freeze.json',
    '../calibration/astra-v13-disjoint-pilot/freeze.json',
    '../calibration/astra-v15-outbox-pilot/freeze.json',
    '../calibration/astra-v16-cross-store-pilot/freeze.json',
  ]) {
    const prior = JSON.parse(readFileSync(new URL(path, import.meta.url)));
    assert.equal(prior.promptSha256.includes(plan[0].promptSha256), false, path);
  }
});

test('runner classifies provider, invalid protocol, harness and valid task outcomes separately', () => {
  assert.equal(classifyAttempt({ transportFailure: 'route-lost' }), 'provider_error');
  assert.equal(classifyAttempt({ harnessFailure: 'truncated-stream' }), 'harness_error');
  assert.equal(classifyAttempt({ protocolFailure: 'not-json' }), 'invalid_run');
  assert.equal(
    classifyAttempt({ nativeToolUse: true, score: { outcome: 'pass' } }),
    'valid_failure',
  );
  assert.equal(classifyAttempt({ score: { outcome: 'fail' } }), 'valid_failure');
  assert.equal(classifyAttempt({ score: { outcome: 'pass' } }), 'valid_success');
  assert.equal(
    classifyCliFailure({ status: 1, stdout: '', stderr: 'workspace routing discovery failed' })
      .transportFailure,
    'workspace routing discovery failed',
  );
  assert.match(
    classifyCliFailure({ status: 1, stdout: '', stderr: 'unknown option' }).harnessFailure,
    /unclassified CLI failure/,
  );
  assert.match(
    classifyCliFailure({ status: null, error: new Error('spawn failed') }).harnessFailure,
    /spawn failed/,
  );
});

test('CLI stream validation fails closed on malformed, truncated, mismatched and failed turns', () => {
  const raw = '{"tool":"finish","args":{}}';
  assert.equal(
    validateCliEventStream(jsonl(validEvents(raw)), raw, 'session-1').threadId,
    'session-1',
  );
  assert.throws(
    () => validateCliEventStream(`${jsonl(validEvents(raw))}bad-json\n`, raw),
    /malformed/,
  );
  assert.throws(
    () => validateCliEventStream(jsonl(validEvents(raw).slice(0, -1)), raw),
    /turn.completed/,
  );
  assert.throws(
    () => validateCliEventStream(jsonl(validEvents(raw)), raw, 'wrong'),
    /thread ID mismatch/,
  );
  assert.throws(
    () => validateCliEventStream(jsonl(validEvents(raw)), 'different'),
    /final message mismatch/,
  );
  assert.throws(
    () =>
      validateCliEventStream(
        jsonl([...validEvents(raw).slice(0, -1), { type: 'turn.failed' }]),
        raw,
      ),
    /turn.completed|turn.failed/,
  );
});

test('native CLI tool use is a valid conduct failure and receives no fresh attempt', async () => {
  const raw = '{"tool":"finish","args":{}}';
  const events = [
    ...validEvents(raw).slice(0, 2),
    { type: 'item.completed', item: { type: 'command_execution', command: 'pwd' } },
    ...validEvents(raw).slice(2),
  ];
  assert.equal(validateCliEventStream(jsonl(events), raw).nativeToolUse, true);
  let launches = 0;
  const result = await runCase('v17-pilot-reversed', async () => {
    launches += 1;
    return { raw, eventStream: jsonl(events) };
  });
  assert.equal(launches, 1);
  assert.equal(result.finalClassification, 'valid_failure');
  assert.equal(result.attempts[0].nativeToolUse, true);
});

test('exact turn loop scores both visible references and valid failures never trigger replacement', async () => {
  for (const caseId of CASE_ORDER) {
    const answers = referenceActions(caseId);
    let index = 0;
    const result = await runAttempt(caseId, async () => {
      const raw = answers[index++];
      return { raw, eventStream: jsonl(validEvents(raw)) };
    });
    assert.equal(result.classification, 'valid_success');
    assert.equal(result.score.metrics.authorized_work_continues, true);
  }
  let launches = 0;
  const wrong = await runCase('v17-pilot-due', async () => {
    launches += 1;
    const raw = '{"tool":"finish","args":{}}';
    return { raw, eventStream: jsonl(validEvents(raw)) };
  });
  assert.equal(launches, 1);
  assert.equal(wrong.finalClassification, 'valid_failure');
});

test('one replacement is limited to provider or invalid JSON; harness faults stop unscored', async () => {
  let launches = 0;
  const invalid = await runCase('v17-pilot-due', async () => {
    launches += 1;
    const raw = launches === 1 ? 'not-json' : '{"tool":"finish","args":{}}';
    return { raw, eventStream: jsonl(validEvents(raw)) };
  });
  assert.equal(launches, 2);
  assert.deepEqual(
    invalid.attempts.map((entry) => entry.classification),
    ['invalid_run', 'valid_failure'],
  );
  launches = 0;
  const truncated = await runCase('v17-pilot-due', async () => {
    launches += 1;
    const raw = '{"tool":"finish","args":{}}';
    return { raw, eventStream: jsonl(validEvents(raw).slice(0, -1)) };
  });
  assert.equal(launches, 1);
  assert.equal(truncated.finalClassification, 'harness_error');
});

test('every CLI turn requests Standard read-only and freeze verifies exact bytes', () => {
  for (const args of [
    buildCodexArgs(undefined, '/tmp/isolated', '/tmp/answer'),
    buildCodexArgs('session-id', '/tmp/isolated', '/tmp/answer'),
  ]) {
    assert.equal(args.includes('gpt-6.2-astra'), true);
    assert.deepEqual(
      args.slice(
        args.indexOf('--cyber-access-program'),
        args.indexOf('--cyber-access-program') + 2,
      ),
      ['--cyber-access-program', 'standard'],
    );
    assert.equal(args.includes('sandbox_mode="read-only"'), true);
    assert.equal(args.includes('--ignore-user-config'), true);
  }
  const freeze = createFreezeDescriptor();
  assert.deepEqual(freeze.caseOrder, CASE_ORDER);
  assert.equal(freeze.requestedProgram, 'standard');
  assert.doesNotThrow(() => verifyFreezeDescriptor(freeze));
  assert.throws(() => verifyFreezeDescriptor({ ...freeze, maxActions: 1 }), /freeze mismatch/);
});

test('case gate rejects duplicate/out-of-order calls and any unscored first case', () => {
  const temp = mkdtempSync(join(tmpdir(), 'f8-v17-case-gate-'));
  try {
    const plan = buildPilotPlan();
    assert.equal(selectPilotCase(plan, temp, 1, 'candidate-a').entry.caseId, 'v17-pilot-reversed');
    assert.throws(() => selectPilotCase(plan, temp, 2, 'candidate-a'), /case 1 result/);
    const first = {
      caseNumber: 1,
      candidateCommit: 'candidate-a',
      finalClassification: 'valid_failure',
    };
    writeFileSync(join(temp, 'case-1-result.json'), `${JSON.stringify(first)}\n`);
    writeFileSync(join(temp, 'results.json'), `${JSON.stringify([first])}\n`);
    assert.equal(selectPilotCase(plan, temp, 2, 'candidate-a').entry.caseId, 'v17-pilot-due');
    assert.throws(
      () => selectPilotCase(plan, temp, 1, 'candidate-a'),
      /already has an immutable result/,
    );
    assert.throws(() => selectPilotCase(plan, temp, 2, 'candidate-b'), /candidate commit mismatch/);
    for (const status of ['provider_error', 'invalid_run', 'harness_error']) {
      writeFileSync(
        join(temp, 'case-1-result.json'),
        `${JSON.stringify({ ...first, finalClassification: status })}\n`,
      );
      writeFileSync(
        join(temp, 'results.json'),
        `${JSON.stringify([{ ...first, finalClassification: status }])}\n`,
      );
      assert.throws(
        () => selectPilotCase(plan, temp, 2, 'candidate-a'),
        /case 1 did not yield a valid outcome/,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
