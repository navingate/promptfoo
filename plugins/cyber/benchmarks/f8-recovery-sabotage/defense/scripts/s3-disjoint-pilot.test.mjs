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
} from './s3-disjoint-pilot.mjs';
import { createS3DisjointIncident } from './s3-disjoint-recovery.mjs';
import { visibleS3PartialReference } from './s3-partial-restore.mjs';

const CASES = ['v13-full-shared', 'v13-required-independent', 'v13-nonrequired-shared'];

test('v13 pilot fixes three disjoint cases and distinct private-label-free prompts', () => {
  const plan = buildPilotPlan();
  assert.deepEqual(
    plan.map((entry) => entry.caseId),
    CASES,
  );
  assert.equal(new Set(plan.map((entry) => entry.promptSha256)).size, 3);
  for (const entry of plan) {
    assert.equal(entry.prompt.includes(entry.caseId), false);
    assert.equal(entry.prompt.includes('_evaluator'), false);
  }
});

test('v13 exact turn loop passes visible reference and keeps wrong decisions valid', async () => {
  const caseId = CASES[2];
  const reference = runVisiblePolicy(createS3DisjointIncident(caseId), visibleS3PartialReference);
  const scripted = [...reference.actions.map((entry) => entry.raw), '{"tool":"finish","args":{}}'];
  let cursor = 0;
  const attempt = await runAttempt(caseId, async (prompt, threadId) => {
    assert.equal(threadId, cursor === 0 ? undefined : 'v13-session');
    assert.equal(prompt.includes(caseId), false);
    return { raw: scripted[cursor++], threadId: 'v13-session', events: [] };
  });
  assert.equal(attempt.classification, 'valid_success');
  assert.equal(attempt.score.outcome, 'pass');
  assert.equal(classifyAttempt({ score: { outcome: 'fail' } }), 'valid_failure');
  assert.equal(classifyAttempt({ transportFailure: 'route unavailable' }), 'provider_error');
  assert.equal(classifyAttempt({ protocolFailure: 'bad JSON' }), 'invalid_run');
});

test('v13 permits one fresh replacement for invalid output, never for valid failure', async () => {
  let sessions = 0;
  const result = await runCase(CASES[0], async (_prompt, threadId) => {
    if (!threadId) {
      sessions += 1;
    }
    return {
      raw: sessions === 1 ? 'not JSON' : '{"tool":"finish","args":{}}',
      threadId: `session-${sessions}`,
    };
  });
  assert.deepEqual(
    result.attempts.map((entry) => entry.classification),
    ['invalid_run', 'valid_failure'],
  );
  assert.equal(sessions, 2);
});

test('v13 every CLI turn requests Standard and starts read-only in empty directory', () => {
  const first = buildCodexArgs(undefined, '/tmp/f8-empty', '/tmp/f8-empty/first.txt');
  const next = buildCodexArgs('session-id', '/tmp/f8-empty', '/tmp/f8-empty/next.txt');
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

test('v13 freeze binds all prompts, native and authored evidence, runner and protocol', () => {
  const descriptor = createFreezeDescriptor();
  assert.deepEqual(descriptor.caseOrder, CASES);
  assert.deepEqual(
    descriptor.promptSha256,
    buildPilotPlan().map((entry) => entry.promptSha256),
  );
  for (const suffix of [
    '/f8-recovery-events-v1.jsonl',
    '/f8-s3-disjoint-extension-v1.json',
    '/produce-s3-disjoint-extension.mjs',
    '/s3-disjoint-recovery.mjs',
    '/s3-disjoint-pilot.mjs',
    '/s3-disjoint-screen.mjs',
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

test('v13 prepare writes distinct exact prompts and descriptor without model calls', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'f8-v13-preflight-'));
  const script = fileURLToPath(new URL('./s3-disjoint-pilot.mjs', import.meta.url));
  const process = spawnSync(
    globalThis.process.execPath,
    [script, '--prepare', '--out-dir', outDir],
    { encoding: 'utf8' },
  );
  assert.equal(process.status, 0, process.stderr);
  verifyFreezeDescriptor(JSON.parse(readFileSync(join(outDir, 'freeze.json'), 'utf8')));
  assert.deepEqual(
    [1, 2, 3].map((index) => readFileSync(join(outDir, `case-${index}-prompt.txt`), 'utf8')),
    buildPilotPlan().map((entry) => entry.prompt),
  );
});
