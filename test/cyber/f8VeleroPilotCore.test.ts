import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const corePath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-pilot-core.mjs',
);

function completed(raw: string, nativeTool = false) {
  const events = [
    { type: 'thread.started', thread_id: 'fresh-thread' },
    { type: 'turn.started' },
    ...(nativeTool ? [{ type: 'item.completed', item: { type: 'command_execution' } }] : []),
    { type: 'item.completed', item: { type: 'agent_message', text: raw } },
    { type: 'turn.completed' },
  ];
  return {
    raw,
    eventStream: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    exitStatus: 0,
  };
}

describe('F8 Velero pilot transport and interaction', () => {
  it('separates valid JSON actions from provider, malformed, harness and native-tool exposure', async () => {
    const { classifyCliTurn } = await import(corePath);
    expect(classifyCliTurn(completed('{"tool":"inspect_release"}')).classification).toBe(
      'valid_action',
    );
    expect(classifyCliTurn(completed('not JSON')).classification).toBe('invalid_run');
    expect(classifyCliTurn(completed('{"tool":"read"}', true)).classification).toBe(
      'isolation_violation',
    );
    const truncated = completed('{"tool":"read"}');
    truncated.eventStream = truncated.eventStream.replace(/\{"type":"turn.completed"\}\n$/, '');
    expect(classifyCliTurn(truncated).classification).toBe('harness_error');
    expect(
      classifyCliTurn({
        raw: '',
        eventStream: '',
        exitStatus: 1,
        stderr: 'workspace routing discovery failed',
      }).classification,
    ).toBe('provider_error');
    const routed = {
      ...completed(''),
      eventStream: [
        { type: 'thread.started', thread_id: 'fresh-thread' },
        { type: 'turn.started' },
        { type: 'error', message: 'Reconnecting: workspace routing discovery timed out' },
        { type: 'turn.completed' },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
    };
    expect(classifyCliTurn(routed).classification).toBe('provider_error');
    const unknown = {
      ...routed,
      eventStream: routed.eventStream.replace(
        'workspace routing discovery timed out',
        'unexpected local parser fault',
      ),
    };
    expect(classifyCliTurn(unknown).classification).toBe('harness_error');
  });

  it('keeps labels and private score outside the fresh-session model prompt', async () => {
    const { buildTurnPrompt } = await import(corePath);
    const prompt = buildTurnPrompt([
      { action: { tool: 'list', path: '' }, observation: { entries: [] } },
    ]);
    expect(prompt).toContain('GO-2026-4918');
    expect(prompt).toContain('"tool":"list"');
    expect(prompt).not.toMatch(/already_patched|historical|privateScore|expectedOutcome/);
  });

  it('preserves a valid wrong submission and does not consume the replacement', async () => {
    const { runCaseWithReplacement } = await import(corePath);
    const sessionFactory = vi.fn(() => ({
      handle: (action: { tool: string }) => ({
        finished: action.tool === 'finish',
        observation: { submitted: true },
        submission: action.tool === 'finish' ? { diagnosis: 'unaffected' } : null,
      }),
      history: () => [],
    }));
    const invocations = vi.fn().mockResolvedValue(completed(JSON.stringify({ tool: 'finish' })));
    const result = await runCaseWithReplacement({ sessionFactory, invoke: invocations });
    expect(result.classification).toBe('submitted');
    expect(result.attempts).toHaveLength(1);
    expect(sessionFactory).toHaveBeenCalledTimes(1);
    expect(invocations).toHaveBeenCalledTimes(1);
  });

  it('restarts only a provider or malformed-model attempt, not a harness fault', async () => {
    const { runCaseWithReplacement } = await import(corePath);
    const sessionFactory = () => ({
      handle: () => ({ finished: true, observation: {}, submission: { diagnosis: 'affected' } }),
      history: () => [],
    });
    const providerThenValid = vi
      .fn()
      .mockResolvedValueOnce({
        raw: '',
        eventStream: '',
        exitStatus: 1,
        stderr: 'workspace routing discovery failed',
      })
      .mockResolvedValueOnce(completed('{"tool":"finish"}'));
    const retried = await runCaseWithReplacement({ sessionFactory, invoke: providerThenValid });
    expect(retried.attempts).toHaveLength(2);
    expect(retried.classification).toBe('submitted');

    const badStream = completed('{"tool":"finish"}');
    badStream.eventStream = '{broken\n';
    const harness = vi.fn().mockResolvedValue(badStream);
    const stopped = await runCaseWithReplacement({ sessionFactory, invoke: harness });
    expect(stopped.classification).toBe('harness_error');
    expect(harness).toHaveBeenCalledTimes(1);
  });

  it('stops unscored when the trusted build tool throws after a valid model action', async () => {
    const { runCaseWithReplacement } = await import(corePath);
    const invoke = vi.fn().mockResolvedValue(completed('{"tool":"build_release"}'));
    const result = await runCaseWithReplacement({
      sessionFactory: () => ({
        handle: () => {
          throw new Error('Docker route unavailable');
        },
        history: () => [],
      }),
      invoke,
    });
    expect(result.classification).toBe('harness_error');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('stops unscored when the interface converts a trusted build fault to an observation', async () => {
    const { runCaseWithReplacement } = await import(corePath);
    const invoke = vi.fn().mockResolvedValue(completed('{"tool":"build_release"}'));
    const result = await runCaseWithReplacement({
      sessionFactory: () => ({
        handle: () => ({
          finished: false,
          observation: { error: 'Docker route unavailable' },
          submission: null,
        }),
        history: () => [],
      }),
      invoke,
    });
    expect(result.classification).toBe('harness_error');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
