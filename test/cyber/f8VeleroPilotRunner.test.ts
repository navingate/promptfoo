import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const runnerPath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-pilot-runner.mjs',
);
const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('F8 Velero pilot freeze and launch gate', () => {
  it('binds neutral initial prompts, source, images, scorer and transport contract', async () => {
    const { createFreezeDescriptor, verifyFreezeDescriptor } = await import(runnerPath);
    const descriptor = createFreezeDescriptor();
    expect(descriptor.caseOrder).toEqual(['01', '02']);
    expect(descriptor.promptSha256[0]).toBe(descriptor.promptSha256[1]);
    expect(descriptor.model).toBe('gpt-6.2-astra');
    expect(descriptor.requestedProgram).toBe('standard');
    expect(
      descriptor.files.some((file: { path: string }) =>
        file.path.endsWith('velero-pilot-score.mjs'),
      ),
    ).toBe(true);
    expect(
      descriptor.files.some((file: { path: string }) => file.path.endsWith('current-image-b.json')),
    ).toBe(true);
    expect(() => verifyFreezeDescriptor(descriptor)).not.toThrow();
    expect(() => verifyFreezeDescriptor({ ...descriptor, model: 'other' })).toThrow();
  });

  it('requests Standard and read-only on every fresh model turn', async () => {
    const { buildModelArgs, buildModelEnvironment } = await import(runnerPath);
    const args = buildModelArgs('/private/var/neutral/workspace', '/private/var/neutral/last.txt', {
      authHome: '/private/var/neutral/auth-only',
      sourceRepo: '/private/tmp/public-tag',
      rawDir: '/private/tmp/private-raw',
    });
    expect(args).toContain('gpt-6.2-astra');
    expect(args).toContain('standard');
    expect(args).toContain('default_permissions="f8v24"');
    expect(args.join(' ')).toContain('"/private/var/neutral/workspace"="read"');
    expect(args.join(' ')).toContain('"/private/var/neutral/auth-only"="deny"');
    expect(args).toContain('--ignore-user-config');
    expect(args).not.toContain('daybreak_blue');
    const env = buildModelEnvironment({
      executable: '/opt/codex/bin/codex',
      home: '/isolated/home',
      codexHome: '/isolated/auth-only',
      temporary: '/isolated/tmp',
    });
    expect(Object.keys(env).sort()).toEqual(['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
    expect(env.PATH).toBe('/opt/codex/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    expect(JSON.stringify(env)).not.toMatch(/AWS_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
    expect(args.join(' ')).toContain('"/private/tmp"="deny"');
    expect(args.join(' ')).toContain('promptfoo"="deny"');
  });

  it('blocks case 2 without a valid hash-bound case 1 and rejects duplicate case 1', async () => {
    const { selectPilotCase } = await import(runnerPath);
    const directory = mkdtempSync(join(tmpdir(), 'velero-pilot-raw-'));
    scratch.push(directory);
    expect(() => selectPilotCase(directory, 1, 'commit', 'freeze', 'prompt')).not.toThrow();
    expect(() => selectPilotCase(directory, 2, 'commit', 'freeze', 'prompt')).toThrow();
    writeFileSync(join(directory, 'case-1-launch.json'), '{}\n');
    expect(() => selectPilotCase(directory, 1, 'commit', 'freeze', 'prompt')).toThrow();
  });

  it('replays the prior score and every raw turn before opening case 2', async () => {
    const { selectPilotCase } = await import(runnerPath);
    const { scoreReleaseSubmission } = await import(
      resolve(
        process.cwd(),
        'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-pilot-score.mjs',
      )
    );
    const directory = mkdtempSync(join(tmpdir(), 'velero-pilot-replay-'));
    scratch.push(directory);
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const rawFiles: Record<string, { file: string; sha256: string }> = {};
    const message = '{"tool":"finish"}';
    const contents = {
      prompt: 'ordinary ticket',
      events: [
        { type: 'thread.started', thread_id: 't' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: message } },
        { type: 'turn.completed' },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
      stderr: '',
      message,
    };
    for (const [kind, bytes] of Object.entries(contents)) {
      const file = `case-1-attempt-1-turn-1-${kind}.txt`;
      writeFileSync(join(directory, file), bytes);
      rawFiles[kind] = { file, sha256: sha256(bytes) };
    }
    const submission = { diagnosis: 'unaffected', finding: {}, files: {}, changedFiles: [] };
    const inspection = { binaries: {}, main: {}, restore: {} };
    const prior = {
      caseNumber: 1,
      caseId: '01',
      candidateCommit: 'commit',
      freezeSha256: 'freeze',
      promptSha256: 'prompt',
      finalClassification: 'valid_failure',
      attempts: [
        {
          attemptNumber: 1,
          classification: 'submitted',
          turns: [
            {
              turnNumber: 1,
              prompt: contents.prompt,
              classification: 'valid_action',
              action: { tool: 'finish' },
              rawFiles,
              exitStatus: 0,
            },
          ],
        },
      ],
      submission,
      inspection,
      score: scoreReleaseSubmission({ initialArm: 'affected', submission, inspection }),
    };
    writeFileSync(join(directory, 'case-1-result.json'), JSON.stringify(prior));
    writeFileSync(join(directory, 'results.json'), JSON.stringify([prior]));
    expect(selectPilotCase(directory, 2, 'commit', 'freeze', 'prompt')).toHaveLength(1);
    writeFileSync(join(directory, rawFiles.message.file), 'tampered');
    expect(() => selectPilotCase(directory, 2, 'commit', 'freeze', 'prompt')).toThrow(
      'raw evidence hash mismatch',
    );
  });

  it('replays a trusted unchanged build before treating a preview failure as candidate feedback', async () => {
    const { wrapPilotSession } = await import(runnerPath);
    const session = (observation: object) => ({
      handle: () => ({ finished: false, observation, submission: null }),
      history: () => [],
    });
    const healthy = vi.fn(() => ({ status: 0 }));
    expect(
      wrapPilotSession(session({ status: 1 }), healthy).handle({ tool: 'build_release' })
        .harnessError,
    ).toBeUndefined();
    expect(healthy).toHaveBeenCalledTimes(1);
    const failed = vi.fn(() => ({ status: 1 }));
    expect(
      wrapPilotSession(session({ status: 1 }), failed).handle({ tool: 'build_release' })
        .harnessError,
    ).toContain('baseline failed');
    expect(
      wrapPilotSession(session({ error: 'Docker unavailable' }), healthy).handle({
        tool: 'build_release',
      }).harnessError,
    ).toContain('unclassified error');
    expect(
      wrapPilotSession(session({ status: null, reviewRequired: true }), healthy).handle({
        tool: 'build_release',
      }).harnessError,
    ).toBeUndefined();
  });

  it('binds the control baseline to its initial fixed source overlay', async () => {
    const { baselineSourceFiles, wrapPilotSession } = await import(runnerPath);
    expect(baselineSourceFiles('historical')).toEqual({});
    const control = baselineSourceFiles('already_patched');
    expect(Object.keys(control)).toEqual(['hack/fix_restic_cve.txt']);
    expect(control['hack/fix_restic_cve.txt']).toContain('golang.org/x/net');
    const preview = vi.fn((files: Record<string, string>) => ({
      status: files['hack/fix_restic_cve.txt'] === control['hack/fix_restic_cve.txt'] ? 0 : 1,
    }));
    const session = {
      handle: () => ({ finished: false, observation: { status: 1 }, submission: null }),
      history: () => [],
    };
    const result = wrapPilotSession(session, () => preview(control)).handle({
      tool: 'build_release',
    });
    expect(result.harnessError).toBeUndefined();
    expect(preview).toHaveBeenCalledWith(control);
  });
});
