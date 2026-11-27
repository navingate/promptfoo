import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runVisiblePolicy } from './payout-ledger-pilot-interface.mjs';
import {
  createOutboxLedgerPilotIncident,
  visibleOutboxPilotReference,
} from './payout-ledger-pilot-recovery.mjs';
import {
  buildCodexArgs,
  buildPilotPlan,
  classifyAttempt,
  createFreezeDescriptor,
  runAttempt,
  runCase,
  verifyFreezeDescriptor,
} from './payout-ledger-pilot-runner.mjs';

const CASES = ['v15-p1-due', 'v15-p1-canceled', 'v15-p2-due', 'v15-p2-canceled'];

test('v15 plan fixes four case order, paired prompt equality, and fresh bindings', () => {
  const plan = buildPilotPlan();
  assert.deepEqual(
    plan.map((entry) => entry.caseId),
    CASES,
  );
  assert.equal(plan[0].prompt, plan[1].prompt);
  assert.equal(plan[2].prompt, plan[3].prompt);
  assert.notEqual(plan[0].prompt, plan[2].prompt);
  for (const entry of plan) {
    assert.equal(entry.prompt.includes(entry.caseId), false);
    assert.equal(entry.prompt.includes('v14-due'), false);
    assert.equal(entry.prompt.includes('v13-full-shared'), false);
    assert.equal(entry.prompt.includes('score'), false);
  }
});

test('v15 obligation bindings do not overlap any prior F8 pilot prompt or v14 pair', () => {
  const calibration = fileURLToPath(new URL('../calibration/', import.meta.url));
  const priorPromptPaths = readdirSync(calibration, { recursive: true })
    .filter((path) => path.endsWith('-prompt.txt') && !path.includes('astra-v15-outbox-pilot/'))
    .map((path) => join(calibration, path));
  assert.ok(priorPromptPaths.length >= 15);
  const priorPrompts = priorPromptPaths.map((path) => readFileSync(path, 'utf8'));
  const v14 = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-outbox-ledger-pair-v1.json', import.meta.url),
      'utf8',
    ),
  );
  const v14References = new Set(v14.common.restored_outbox.map((row) => row.reference));
  const priorPlan = JSON.parse(
    readFileSync(
      new URL('../calibration/astra-v9-payout-pilot/case-plan.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    priorPlan.some((entry) => [1501, 1502].includes(entry.seed)),
    false,
  );
  for (const entry of buildPilotPlan()) {
    assert.equal(
      priorPrompts.some((prompt) => prompt === entry.prompt),
      false,
    );
    const incident = createOutboxLedgerPilotIncident(entry.caseId);
    for (const row of [
      ...incident.visibleStart.restored_outbox,
      incident.visibleStart.new_due_payout,
    ]) {
      assert.equal(v14References.has(row.reference), false);
      assert.equal(
        priorPrompts.some((prompt) => prompt.includes(row.reference)),
        false,
      );
    }
  }
});

test('v15 exact turn loop passes visible reference on all four cases', async () => {
  for (const caseId of CASES) {
    const reference = runVisiblePolicy(
      createOutboxLedgerPilotIncident(caseId),
      visibleOutboxPilotReference,
    );
    const scripted = [
      ...reference.actions.map((entry) => entry.raw),
      '{"tool":"finish","args":{}}',
    ];
    let cursor = 0;
    const attempt = await runAttempt(caseId, async (prompt, threadId) => {
      assert.equal(threadId, cursor === 0 ? undefined : `session-${caseId}`);
      assert.equal(prompt.includes(caseId), false);
      return { raw: scripted[cursor++], threadId: `session-${caseId}`, events: [] };
    });
    assert.equal(attempt.classification, 'valid_success', caseId);
    assert.equal(attempt.score.metrics.reported_disposition, 'supported');
    assert.equal(cursor, scripted.length);
  }
});

test('v15 invalid and provider failures permit one replacement; valid wrong action stands', async () => {
  assert.equal(classifyAttempt({ transportFailure: 'route unavailable' }), 'provider_error');
  assert.equal(classifyAttempt({ protocolFailure: 'non-JSON' }), 'invalid_run');
  assert.equal(classifyAttempt({ score: { outcome: 'fail' } }), 'valid_failure');
  let sessions = 0;
  const invalid = await runCase(CASES[0], async (_prompt, threadId) => {
    if (!threadId) {
      sessions += 1;
    }
    return {
      raw: sessions === 1 ? 'not JSON' : '{"tool":"finish","args":{}}',
      threadId: `s${sessions}`,
    };
  });
  assert.deepEqual(
    invalid.attempts.map((entry) => entry.classification),
    ['invalid_run', 'valid_failure'],
  );
  assert.equal(sessions, 2);

  let validSessions = 0;
  const valid = await runCase(CASES[0], async (_prompt, threadId) => {
    if (!threadId) {
      validSessions += 1;
    }
    return { raw: '{"tool":"unknown","args":{}}', threadId: `s${validSessions}` };
  });
  assert.equal(valid.attempts.length, 1);
  assert.equal(valid.finalClassification, 'valid_failure');
  assert.equal(validSessions, 1);

  let providerSessions = 0;
  const unavailable = await runCase(CASES[0], async () => {
    providerSessions += 1;
    return { raw: '', transportFailure: 'route unavailable' };
  });
  assert.equal(providerSessions, 2);
  assert.deepEqual(
    unavailable.attempts.map((entry) => entry.classification),
    ['provider_error', 'provider_error'],
  );
  assert.equal(unavailable.finalClassification, 'provider_error');
  const missing = await runAttempt(CASES[0], async () => undefined);
  assert.equal(missing.classification, 'provider_error');
});

test('v15 every CLI turn requests Standard and uses empty read-only first session', () => {
  const first = buildCodexArgs(undefined, '/tmp/f8-empty', '/tmp/f8-empty/turn.txt');
  const next = buildCodexArgs('session-id', '/tmp/f8-empty', '/tmp/f8-empty/turn-2.txt');
  for (const args of [first, next]) {
    assert.deepEqual(
      args.slice(
        args.indexOf('--cyber-access-program'),
        args.indexOf('--cyber-access-program') + 2,
      ),
      ['--cyber-access-program', 'standard'],
    );
    assert.ok(args.includes('gpt-6.2-astra'));
    assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.includes('sandbox_mode="read-only"'));
  }
  assert.ok(first.includes('read-only'));
  assert.ok(first.includes('/tmp/f8-empty'));
  assert.ok(next.includes('resume'));
});

test('v15 descriptor binds exact prompt, fixture, scorer, runner, and protocol bytes', () => {
  const descriptor = createFreezeDescriptor();
  assert.deepEqual(descriptor.caseOrder, CASES);
  assert.deepEqual(
    descriptor.promptSha256,
    buildPilotPlan().map((entry) => entry.promptSha256),
  );
  for (const suffix of [
    '/f8-outbox-ledger-pilot-v1.json',
    '/produce-outbox-ledger-pilot.mjs',
    '/payout-ledger-pilot-recovery.mjs',
    '/payout-ledger-pilot-runner.mjs',
    '/payout-ledger-pilot-interface.mjs',
    '/protocol.md',
  ]) {
    assert.ok(
      descriptor.files.some((entry) => entry.path.endsWith(suffix)),
      suffix,
    );
  }
  assert.doesNotThrow(() => verifyFreezeDescriptor(descriptor));
  assert.throws(
    () => verifyFreezeDescriptor({ ...descriptor, promptSha256: [] }),
    /freeze mismatch/,
  );
});

test('v15 prepare writes exact blind prompts and descriptor without a model call', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'f8-v15-preflight-'));
  const script = fileURLToPath(new URL('./payout-ledger-pilot-runner.mjs', import.meta.url));
  const process = spawnSync(
    globalThis.process.execPath,
    [script, '--prepare', '--out-dir', outDir],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(process.status, 0, process.stderr);
  verifyFreezeDescriptor(JSON.parse(readFileSync(join(outDir, 'freeze.json'), 'utf8')));
  assert.deepEqual(
    [1, 2, 3, 4].map((index) => readFileSync(join(outDir, `case-${index}-prompt.txt`), 'utf8')),
    buildPilotPlan().map((entry) => entry.prompt),
  );
});
