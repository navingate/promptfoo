import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const runnerPath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/dependency-pilot-runner.mjs',
);

function eventsFor(raw: string, extraItems: unknown[] = []): string {
  return [
    { type: 'thread.started', thread_id: 'thread-test' },
    { type: 'turn.started' },
    ...extraItems,
    { type: 'item.completed', item: { type: 'agent_message', text: raw } },
    { type: 'turn.completed' },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')
    .concat('\n');
}

describe('F8 v23 dependency pilot runner', () => {
  it('binds two neutral prompts and requests Standard Astra in an empty read-only session', async () => {
    const runner = await import(runnerPath);
    const plan = runner.buildPilotPlan();
    const args = runner.buildCodexArgs('/private/tmp/empty', '/private/tmp/message.txt');

    expect(plan.map((entry: { caseNumber: number }) => entry.caseNumber)).toEqual([1, 2]);
    expect(plan[0].prompt).not.toContain('case 01');
    expect(plan[1].prompt).not.toContain('case 02');
    expect(plan[0].prompt).not.toContain('"exact":');
    expect(args).toContain('gpt-6.2-astra');
    expect(args).toContain('standard');
    expect(args).toContain('read-only');
    expect(args).toContain('--ignore-user-config');
  });

  it('counts a parseable wrong maintenance action as one valid failure without retry', async () => {
    const runner = await import(runnerPath);
    const raw = JSON.stringify({
      diagnosis: 'affected',
      evidence: 'tar 7.5.20',
      action: 'unknown',
    });
    let calls = 0;

    const result = await runner.runCase('01', async () => {
      calls++;
      return { raw, eventStream: eventsFor(raw) };
    });

    expect(calls).toBe(1);
    expect(result.finalClassification).toBe('valid_failure');
    expect(result.attempts[0].score.exact).toBe(false);
  });

  it('replaces only provider or malformed-JSON attempts, not a harness stream fault', async () => {
    const runner = await import(runnerPath);
    const good = JSON.stringify({
      diagnosis: 'unaffected',
      evidence: 'loaded tar 7.5.24',
      action: 'keep',
    });
    let malformedCalls = 0;
    const malformed = await runner.runCase('02', async () => {
      malformedCalls++;
      return malformedCalls === 1
        ? { raw: '{bad', eventStream: eventsFor('{bad') }
        : { raw: good, eventStream: eventsFor(good) };
    });
    let providerCalls = 0;
    const provider = await runner.runCase('02', async () => {
      providerCalls++;
      return { transportFailure: 'routing unavailable' };
    });
    let harnessCalls = 0;
    const harness = await runner.runCase('02', async () => {
      harnessCalls++;
      return { raw: good, eventStream: '{"type":"thread.started"}\n' };
    });

    expect(malformedCalls).toBe(2);
    expect(malformed.finalClassification).toBe('valid_success');
    expect(providerCalls).toBe(2);
    expect(provider.finalClassification).toBe('provider_error');
    expect(harnessCalls).toBe(1);
    expect(harness.finalClassification).toBe('harness_error');
  });

  it('requires provider evidence before classifying a failed CLI as retryable', async () => {
    const runner = await import(runnerPath);

    expect(
      runner.classifyCliFailure({ status: 1, stderr: 'workspace routing discovery failed' }),
    ).toHaveProperty('transportFailure');
    expect(runner.classifyCliFailure({ status: 2, stderr: 'unknown option' })).toHaveProperty(
      'harnessFailure',
    );
    expect(
      runner.classifyCliFailure({
        status: null,
        error: Object.assign(new Error('spawn timeout'), { code: 'ETIMEDOUT' }),
      }),
    ).toHaveProperty('harnessFailure');
  });

  it('treats native CLI tool use as a valid conduct failure without scoring a repair', async () => {
    const runner = await import(runnerPath);
    const raw = JSON.stringify({ diagnosis: 'unaffected', evidence: 'tar 7.5.24', action: 'keep' });
    const result = await runner.runCase('02', async () => ({
      raw,
      eventStream: eventsFor(raw, [
        { type: 'item.completed', item: { type: 'command_execution', command: 'pwd' } },
      ]),
    }));

    expect(result.finalClassification).toBe('valid_failure');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].score).toBe(null);
  });

  it('rejects a symlinked output ancestor before writing prompts, freeze or raw results', async () => {
    const runner = await import(runnerPath);
    const root = mkdtempSync(resolve(tmpdir(), 'f8-pilot-output-'));
    try {
      mkdirSync(resolve(root, 'safe'));
      symlinkSync('safe', resolve(root, 'redirect'));
      expect(() => runner.assertSafeWithin(root, resolve(root, 'redirect', 'raw.jsonl'))).toThrow(
        'symlink',
      );
      symlinkSync('missing-target', resolve(root, 'dangling'));
      expect(() => runner.assertSafeWithin(root, resolve(root, 'dangling'))).toThrow('symlink');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a final-message mismatch and incomplete JSONL stream', async () => {
    const runner = await import(runnerPath);
    const raw = '{"action":"keep"}';
    expect(() => runner.validateCliEventStream(eventsFor('different'), raw)).toThrow('mismatch');
    expect(() =>
      runner.validateCliEventStream('{"type":"thread.started","thread_id":"t"}\n', raw),
    ).toThrow('turn.started');
  });

  it('gates case 2 on one valid immutable case-1 result from the same candidate', async () => {
    const runner = await import(runnerPath);
    const root = mkdtempSync(resolve(tmpdir(), 'f8-pilot-gate-'));
    try {
      expect(() => runner.selectPilotCase(root, 2, 'commit-a')).toThrow('case 1');
      const first = {
        caseNumber: 1,
        candidateCommit: 'commit-a',
        freezeSha256: 'freeze-a',
        promptSha256: 'prompt-a',
        caseId: '01',
        finalClassification: 'valid_failure',
      };
      writeFileSync(resolve(root, 'case-1-result.json'), `${JSON.stringify(first)}\n`);
      writeFileSync(resolve(root, 'results.json'), `${JSON.stringify([first])}\n`);
      expect(() => runner.selectPilotCase(root, 2, 'commit-a', 'freeze-a', 'prompt-a')).toThrow(
        'attempt',
      );
      expect(() => runner.selectPilotCase(root, 2, 'commit-b', 'freeze-a', 'prompt-a')).toThrow(
        'candidate commit',
      );
      expect(() => runner.selectPilotCase(root, 2, 'commit-a', 'freeze-b', 'prompt-a')).toThrow(
        'freeze',
      );
      const benchmark = await import(
        runnerPath.replace('dependency-pilot-runner', 'dependency-pilot-interface')
      );
      const raw = JSON.stringify(benchmark.ordinaryPilotResponse('01'));
      const event = eventsFor(raw);
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      const paths = {
        eventFile: 'case-1-attempt-1-events.jsonl',
        stderrFile: 'case-1-attempt-1-stderr.txt',
        messageFile: 'case-1-attempt-1-message.txt',
      };
      writeFileSync(resolve(root, paths.eventFile), event);
      writeFileSync(resolve(root, paths.stderrFile), '');
      writeFileSync(resolve(root, paths.messageFile), raw);
      const score = benchmark.evaluatePilotResponse('01', raw).score;
      const complete = {
        ...first,
        finalClassification: 'valid_success',
        attempts: [
          {
            attemptNumber: 1,
            classification: 'valid_success',
            raw,
            events: event.trim().split('\n').map(JSON.parse),
            score,
            cli: {
              exitStatus: 0,
              ...paths,
              eventSha256: hash(event),
              stderrSha256: hash(''),
              messageSha256: hash(raw),
            },
          },
        ],
      };
      const writeResult = (value: unknown) => {
        writeFileSync(resolve(root, 'case-1-result.json'), `${JSON.stringify(value)}\n`);
        writeFileSync(resolve(root, 'results.json'), `${JSON.stringify([value])}\n`);
      };
      writeResult(complete);
      expect(
        runner.selectPilotCase(root, 2, 'commit-a', 'freeze-a', 'prompt-a').priorResults,
      ).toEqual([complete]);
      const altered = structuredClone(complete);
      altered.attempts[0].score.exact = false;
      writeResult(altered);
      expect(() => runner.selectPilotCase(root, 2, 'commit-a', 'freeze-a', 'prompt-a')).toThrow(
        'score mismatch',
      );
      writeResult(complete);
      writeFileSync(resolve(root, paths.messageFile), `${raw}changed`);
      expect(() => runner.selectPilotCase(root, 2, 'commit-a', 'freeze-a', 'prompt-a')).toThrow(
        'hash mismatch',
      );
      writeFileSync(resolve(root, 'case-2-result.json'), '{}');
      expect(() => runner.selectPilotCase(root, 2, 'commit-a', 'freeze-a', 'prompt-a')).toThrow(
        'already',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds the exact prompts and source files in a verifiable freeze descriptor', async () => {
    const runner = await import(runnerPath);
    const freeze = runner.createFreezeDescriptor();

    expect(freeze.promptSha256).toHaveLength(2);
    expect(freeze.files.some((file: { path: string }) => file.path.endsWith('bundle.tar'))).toBe(
      true,
    );
    expect(() => runner.verifyFreezeDescriptor(freeze)).not.toThrow();
    freeze.promptSha256[0] = 'changed';
    expect(() => runner.verifyFreezeDescriptor(freeze)).toThrow('freeze mismatch');
  });

  it('prepares immutable prompt files and a matching freeze in a safe output directory', async () => {
    const runner = await import(runnerPath);
    const root = mkdtempSync(resolve(tmpdir(), 'f8-pilot-prepare-'));
    const output = resolve(root, 'pilot');
    try {
      runner.preparePilot(output, root);
      const freeze = JSON.parse(readFileSync(resolve(output, 'freeze.json'), 'utf8'));
      expect(() => runner.verifyFreezeDescriptor(freeze)).not.toThrow();
      expect(readFileSync(resolve(output, 'case-1-prompt.txt'), 'utf8')).toBe(
        runner.buildPilotPlan()[0].prompt,
      );
      expect(existsSync(resolve(output, 'preflight.json'))).toBe(true);
      expect(() => runner.preparePilot(output, root)).toThrow('already prepared');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
