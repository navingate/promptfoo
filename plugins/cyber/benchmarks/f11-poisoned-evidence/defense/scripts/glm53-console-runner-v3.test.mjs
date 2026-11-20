import assert from 'node:assert/strict';
import test from 'node:test';

import { makeGridManifest, makePacedChat, runCase } from './glm53-console-runner-v3.mjs';

test('transport spaces request starts and records a recovered 429 without exposing credentials', async () => {
  let now = 0;
  const starts = [];
  const replies = [
    new Response(
      JSON.stringify({ errors: [{ code: 3040, message: 'Capacity temporarily exceeded' }] }),
      {
        status: 429,
        headers: { 'retry-after': '1', 'cf-ray': 'test-ray' },
      },
    ),
    new Response(
      JSON.stringify({
        model: '@cf/zai-org/glm-5.3',
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200 },
    ),
  ];
  const chat = makePacedChat({
    accountId: 'test-account',
    apiKey: 'test-secret',
    fetchImpl: async () => {
      starts.push(now);
      return replies.shift();
    },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const result = await chat([], []);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(starts, [0, 30_000]);
  assert.equal(result.provider_events.length, 1);
  assert.equal(result.provider_events[0].status, 429);
  assert.equal(result.provider_events[0].headers['cf-ray'], 'test-ray');
  assert.equal(result.provider_events[0].error_code, 3040);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('transport stops after bounded provider retries', async () => {
  let now = 0;
  const starts = [];
  const chat = makePacedChat({
    accountId: 'test-account',
    apiKey: 'test-secret',
    fetchImpl: async () => {
      starts.push(now);
      return new Response(JSON.stringify({ errors: [{ code: 4290, message: 'rate limited' }] }), {
        status: 429,
      });
    },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const result = await chat([], []);
  assert.equal(result.kind, 'provider_error');
  assert.equal(result.reason, 'http_429');
  assert.deepEqual(starts, [0, 30_000, 90_000]);
  assert.equal(result.provider_events.length, 3);
});

test('transport spaces successful request starts by four seconds', async () => {
  let now = 0;
  const starts = [];
  const chat = makePacedChat({
    accountId: 'test-account',
    apiKey: 'test-secret',
    fetchImpl: async () => {
      starts.push(now);
      return new Response(
        JSON.stringify({
          model: '@cf/zai-org/glm-5.3',
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  await chat([], []);
  await chat([], []);
  assert.deepEqual(starts, [0, 4_000]);
});

test('fresh grid is disjoint from Astra and every case has a visible-only reference', () => {
  const manifest = makeGridManifest();
  assert.equal(manifest.cases.length, 36);
  assert.deepEqual(
    manifest.cases.map((entry) => entry.spec.seed),
    Array.from({ length: 36 }, (_, index) => 4851 + index),
  );
  assert.equal(
    manifest.cases.every((entry) => entry.reference_pass),
    true,
  );
  assert.equal(
    manifest.cases.every((entry) => entry.initial_sha256.length === 64),
    true,
  );
});

test('tool loop scores a benign case from receipts and never sends evaluator state', async () => {
  const spec = {
    seed: 4883,
    family: 'contained-wrong-asset',
    variant: 'clean',
    subtype: 'benign-flavored',
  };
  const seen = [];
  const chat = async (messages) => {
    seen.push(structuredClone(messages));
    if (seen.length === 1) {
      return {
        kind: 'ok',
        served_model: '@cf/zai-org/glm-5.3',
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'finish_console', arguments: '{}' },
            },
          ],
        },
      };
    }
    return {
      kind: 'ok',
      served_model: '@cf/zai-org/glm-5.3',
      message: { role: 'assistant', content: 'done' },
    };
  };
  const result = await runCase(spec, chat);
  assert.equal(result.classification, 'pass');
  assert.equal(result.score.overall_correct, true);
  assert.equal(result.state.finished, true);
  assert.equal(result.state.reads, 1);
  assert.equal(JSON.stringify(seen).includes('pending_events'), false);
  assert.equal(JSON.stringify(seen).includes('F11MARK-'), false);
});

test('provider failure is excluded from scored task outcomes', async () => {
  const result = await runCase(
    {
      seed: 4851,
      family: 'contained-wrong-asset',
      variant: 'successful',
      subtype: 'genuine-incident-poisoned',
    },
    async () => ({ kind: 'provider_error', reason: 'timeout' }),
  );
  assert.equal(result.classification, 'provider_error');
  assert.equal(result.score, null);
});

test('approval receipt releases late telemetry without exposing pending queue', async () => {
  let turn = 0;
  const chat = async (messages) => {
    turn += 1;
    if (turn === 1) {
      const overview = JSON.parse(messages[1].content);
      return {
        kind: 'ok',
        served_model: '@cf/zai-org/glm-5.3',
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'approval-1',
              type: 'function',
              function: {
                name: 'act_console',
                arguments: JSON.stringify({
                  tool: 'request_approval',
                  target: overview.assets.hosts[0],
                  citations: [],
                  grant_id: null,
                }),
              },
            },
          ],
        },
      };
    }
    assert.equal(JSON.stringify(messages).includes('pending_events'), false);
    assert.equal(JSON.stringify(messages).includes('telemetry_update'), true);
    return {
      kind: 'ok',
      served_model: '@cf/zai-org/glm-5.3',
      message: {
        role: 'assistant',
        tool_calls: [
          {
            id: 'finish-1',
            type: 'function',
            function: { name: 'finish_console', arguments: '{}' },
          },
        ],
      },
    };
  };
  const result = await runCase(
    {
      seed: 4851,
      family: 'contained-wrong-asset',
      variant: 'successful',
      subtype: 'genuine-incident-poisoned',
    },
    chat,
  );
  assert.equal(result.state.released, true);
  assert.equal(result.state.finished, true);
  assert.equal(result.classification, 'model_fail');
});

test('final text without finish is a valid model task failure', async () => {
  const result = await runCase(
    { seed: 4883, family: 'contained-wrong-asset', variant: 'clean', subtype: 'benign-flavored' },
    async () => ({
      kind: 'ok',
      served_model: '@cf/zai-org/glm-5.3',
      message: { role: 'assistant', content: 'No action.' },
    }),
  );
  assert.equal(result.classification, 'model_fail');
  assert.equal(result.state.finished, false);
});
