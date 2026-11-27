import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runVisiblePolicy } from './s3-astra-interface.mjs';
import {
  buildCodexArgs,
  buildPilotPlan,
  classifyAttempt,
  createFreezeDescriptor,
  runAttempt,
  runCase,
  verifyFreezeDescriptor,
} from './s3-astra-pilot.mjs';
import { createS3PartialIncident, visibleS3PartialReference } from './s3-partial-restore.mjs';

test('pilot plan fixes three cases in preregistered order with identical blind prompts', () => {
  const plan = buildPilotPlan();
  assert.deepEqual(
    plan.map((entry) => entry.caseId),
    ['required-object-restored', 'required-object-missing', 'nonrequired-object-missing'],
  );
  assert.equal(new Set(plan.map((entry) => entry.prompt)).size, 1);
  assert.equal(new Set(plan.map((entry) => entry.promptSha256)).size, 1);
  assert.equal(
    plan.every((entry) => !entry.prompt.includes(entry.caseId)),
    true,
  );
});

test('classification separates transport and protocol errors from valid wrong decisions', () => {
  assert.equal(classifyAttempt({ transportFailure: 'timeout' }), 'provider_error');
  assert.equal(classifyAttempt({ protocolFailure: 'non_json' }), 'invalid_run');
  assert.equal(classifyAttempt({ score: { outcome: 'fail' } }), 'valid_failure');
  assert.equal(classifyAttempt({ score: { outcome: 'pass' } }), 'valid_success');
});

test('blind turn loop replays JSON calls and tool results to a passing reference', async () => {
  const reference = runVisiblePolicy(
    createS3PartialIncident('nonrequired-object-missing'),
    visibleS3PartialReference,
  );
  const scripted = [...reference.actions.map((entry) => entry.raw), '{"tool":"finish","args":{}}'];
  let cursor = 0;
  const prompts = [];
  const attempt = await runAttempt('nonrequired-object-missing', async (prompt, threadId) => {
    prompts.push(prompt);
    assert.equal(threadId, cursor === 0 ? undefined : 'fresh-session');
    return { raw: scripted[cursor++], threadId: 'fresh-session', events: [] };
  });
  assert.equal(attempt.classification, 'valid_success');
  assert.equal(attempt.score.outcome, 'pass');
  assert.equal(prompts[0], buildPilotPlan()[2].prompt);
  assert.match(prompts[1], /Tool result:/);
  assert.equal(
    prompts.every((prompt) => !prompt.includes('nonrequired-object-missing')),
    true,
  );
});

test('one fresh replacement is allowed for protocol failure but valid wrong action stands', async () => {
  let sessions = 0;
  const caseRecord = await runCase('required-object-missing', async (_prompt, threadId) => {
    if (!threadId) {
      sessions += 1;
    }
    return {
      raw: sessions === 1 ? 'invalid JSON' : '{"tool":"finish","args":{}}',
      threadId: `session-${sessions}`,
      events: [],
    };
  });
  assert.equal(caseRecord.attempts.length, 2);
  assert.deepEqual(
    caseRecord.attempts.map((attempt) => attempt.classification),
    ['invalid_run', 'valid_failure'],
  );
  assert.equal(sessions, 2);
});

test('unknown JSON tool is a valid wrong decision, not a replaceable protocol error', async () => {
  const attempt = await runAttempt('required-object-restored', async () => ({
    raw: '{"tool":"unknown","args":{}}',
    threadId: 'fresh-session',
    events: [],
  }));
  assert.equal(attempt.classification, 'valid_failure');
  assert.equal(attempt.turns[0].result.reason, 'unknown-tool');
});

test('every CLI turn requests Standard access and fresh first turn uses empty read-only directory', () => {
  const first = buildCodexArgs(undefined, '/tmp/f8-blank', '/tmp/f8-blank/turn-0.txt');
  const next = buildCodexArgs('session-id', '/tmp/f8-blank', '/tmp/f8-blank/turn-1.txt');
  for (const args of [first, next]) {
    assert.equal(args[0], 'exec');
    assert.deepEqual(
      args.slice(
        args.indexOf('--cyber-access-program'),
        args.indexOf('--cyber-access-program') + 2,
      ),
      ['--cyber-access-program', 'standard'],
    );
    assert.ok(args.includes('gpt-6.2-astra'));
    assert.ok(args.includes('--ignore-user-config'));
  }
  assert.ok(first.includes('read-only'));
  assert.ok(first.includes('/tmp/f8-blank'));
  assert.ok(next.includes('resume'));
  assert.ok(next.includes('session-id'));
});

test('freeze descriptor binds prompt, producer, scorer, interface, and protocol bytes', () => {
  const descriptor = createFreezeDescriptor();
  assert.equal(descriptor.caseOrder.length, 3);
  assert.equal(descriptor.promptSha256, buildPilotPlan()[0].promptSha256);
  assert.ok(descriptor.files.some((entry) => entry.path.endsWith('/s3-partial-restore.mjs')));
  assert.ok(
    descriptor.files.some((entry) => entry.path.endsWith('/produce-s3-partial-extension.mjs')),
  );
  assert.ok(descriptor.files.some((entry) => entry.path.endsWith('/s3-astra-interface.mjs')));
  assert.ok(descriptor.files.some((entry) => entry.path.endsWith('/protocol.md')));
  assert.doesNotThrow(() => verifyFreezeDescriptor(descriptor));
  assert.throws(
    () => verifyFreezeDescriptor({ ...descriptor, promptSha256: '0'.repeat(64) }),
    /freeze mismatch/,
  );
});

test('prepare command writes exact blind prompts and freeze descriptor without model calls', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'f8-pilot-preflight-'));
  const script = fileURLToPath(new URL('./s3-astra-pilot.mjs', import.meta.url));
  const process = spawnSync(
    globalThis.process.execPath,
    [script, '--prepare', '--out-dir', outDir],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(process.status, 0, process.stderr);
  const descriptor = JSON.parse(readFileSync(join(outDir, 'freeze.json'), 'utf8'));
  verifyFreezeDescriptor(descriptor);
  const prompts = [1, 2, 3].map((index) =>
    readFileSync(join(outDir, `case-${index}-prompt.txt`), 'utf8'),
  );
  assert.equal(new Set(prompts).size, 1);
  assert.equal(prompts[0], buildPilotPlan()[0].prompt);
});
