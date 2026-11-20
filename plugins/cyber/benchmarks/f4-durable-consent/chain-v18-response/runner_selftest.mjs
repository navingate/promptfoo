import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LIMITS, MODEL_SETTINGS } from './config.mjs';
import { buildCorpus, freezeCorpus } from './corpus.mjs';
import { runReference } from './reference.mjs';

const model = MODEL_SETTINGS.model_id;
const endpoint = 'https://mock.example/v1';
const apiKey = 'mock-secret';

async function runner() {
  const module = await import('./runner.mjs').catch(() => null);
  assert.ok(module?.runCase, 'runner.mjs is missing');
  return module;
}

function nativeResponse(
  command,
  { servedModel = model, completionTokens = 10, finishReason = 'tool_calls' } = {},
) {
  return new Response(
    JSON.stringify({
      model: servedModel,
      choices: [
        {
          finish_reason: finishReason,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: command.tool, arguments: JSON.stringify(command.args ?? {}) },
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: completionTokens },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function rawResponse({
  toolCalls = [],
  finishReason = 'stop',
  servedModel = model,
  completionTokens = 10,
} = {}) {
  return new Response(
    JSON.stringify({
      model: servedModel,
      choices: [
        {
          finish_reason: finishReason,
          message: { role: 'assistant', content: null, tool_calls: toolCalls },
        },
      ],
      usage: { completion_tokens: completionTokens },
    }),
    { status: 200 },
  );
}

function options(request) {
  let now = 0;
  const sleeps = [];
  return {
    endpoint,
    apiKey,
    request,
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    sleeps,
  };
}

function firstCase() {
  return buildCorpus()[0];
}

function referenceCommands(item) {
  const episode = {
    ...item.native,
    hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
  };
  return runReference(episode).transcript.map((entry) => entry.command);
}

test('one native call per turn replays a visible-only exact reference with exact model echo and pacing', async () => {
  const { runCase } = await runner();
  const item = firstCase();
  const commands = referenceCommands(item);
  const requests = [];
  const settings = options(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return nativeResponse(commands[requests.length - 1]);
  });
  const result = await runCase(item, settings);
  assert.equal(result.classification, 'exact');
  assert.equal(result.score.exact, true);
  assert.equal(result.turns, commands.length);
  assert.equal(result.actions, commands.length);
  assert.equal(result.raw_responses.length, commands.length);
  assert.equal(requests.length, commands.length);
  assert.deepEqual(settings.sleeps, Array(commands.length - 1).fill(5000));
  for (const { url, init, body } of requests) {
    assert.equal(url, `${endpoint}/chat/completions`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['cf-aig-skip-cache'], 'true');
    assert.equal(body.model, model);
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.temperature, 0);
    assert.equal(body.stream, false);
    assert.equal(body.max_completion_tokens, LIMITS.completion_tokens_per_turn);
    assert.equal(
      body.messages.some((message) => JSON.stringify(message).includes(apiKey)),
      false,
    );
  }
  assert.equal(requests[1].body.messages.at(-1).role, 'tool');
  assert.equal(
    result.request_audit.every((entry) => entry.served_model === model),
    true,
  );
  assert.equal(
    result.request_audit.every((entry) => entry.requested_model === model),
    true,
  );
  assert.equal(
    result.request_audit.every((entry) => entry.response_status === 200),
    true,
  );
  assert.equal(
    result.request_audit.every(
      (entry, index) =>
        index === 0 || entry.started_ms - result.request_audit[index - 1].started_ms >= 5000,
    ),
    true,
  );
});

test('one bounded structural correction stays in the attempt and retains malformed raw output', async () => {
  const { runCase } = await runner();
  const item = firstCase();
  const commands = referenceCommands(item);
  const calls = [];
  const multi = rawResponse({
    finishReason: 'tool_calls',
    toolCalls: [
      { id: 'a', type: 'function', function: { name: 'get_dashboard', arguments: '{}' } },
      { id: 'b', type: 'function', function: { name: 'get_jobs', arguments: '{}' } },
    ],
  });
  const settings = options(async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return calls.length === 1 ? multi.clone() : nativeResponse(commands[calls.length - 2]);
  });
  const result = await runCase(item, settings);
  assert.equal(result.classification, 'exact');
  assert.equal(result.turns, commands.length + 1);
  assert.equal(result.actions, commands.length);
  assert.equal(result.structural_corrections, 1);
  assert.equal(result.raw_responses[0].choices[0].message.tool_calls.length, 2);
  assert.deepEqual(calls[1].messages.at(-2), { role: 'assistant', content: '' });
  assert.match(calls[1].messages.at(-1).content, /exactly one function call/u);
  assert.equal(JSON.stringify(calls[1].messages).includes('expected_findings'), false);
});

test('multiple, absent, and malformed calls cannot silently execute or retry after correction', async () => {
  const { runCase } = await runner();
  const malformed = [
    rawResponse({
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'a', type: 'function', function: { name: 'submit', arguments: '{' } }],
    }),
    rawResponse({ finishReason: 'stop', toolCalls: [] }),
    rawResponse({
      finishReason: 'tool_calls',
      toolCalls: [
        { id: 'a', type: 'function', function: { name: 'get_jobs', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'get_dashboard', arguments: '{}' } },
      ],
    }),
  ];
  for (const first of malformed) {
    let calls = 0;
    const result = await runCase(
      firstCase(),
      options(async () => {
        calls++;
        return (calls === 1 ? first : rawResponse()).clone();
      }),
    );
    assert.equal(result.classification, 'format_fail');
    assert.equal(result.turns, 2);
    assert.equal(result.actions, 0);
    assert.equal(result.raw_responses.length, 2);
    assert.equal(result.structural_corrections, 1);
    assert.equal(calls, 2);
  }
});

test('schema-invalid arguments use the one structural correction without native actions', async () => {
  const { runCase } = await runner();
  for (const command of [
    { tool: 'get_user_grants', args: {} },
    { tool: 'get_user_grants', args: { user_id: '' } },
    { tool: 'get_user_grants', args: { user_id: 'user', extra: 'field' } },
    { tool: 'set_quarantine', args: { user_id: 'user', on: 'true' } },
    { tool: 'submit', args: { findings: [{ grant_id: 'grant' }] } },
    {
      tool: 'submit',
      args: {
        findings: [
          {
            grant_id: 'grant',
            created_event_id: 'created',
            reset_event_id: 'reset',
            token_event_id: 'token',
            call_event_id: '',
          },
        ],
      },
    },
  ]) {
    let calls = 0;
    const result = await runCase(
      firstCase(),
      options(async () => {
        calls++;
        return nativeResponse(command);
      }),
    );
    assert.equal(result.classification, 'format_fail', JSON.stringify(command));
    assert.equal(result.structural_corrections, 1);
    assert.equal(result.turns, 2);
    assert.equal(result.actions, 0);
    assert.equal(calls, 2);
  }
});

test('valid argument shape with a wrong identifier reaches native feedback as a model decision', async () => {
  const { runCase } = await runner();
  const commands = [
    { tool: 'get_user_grants', args: { user_id: 'wrong-but-nonempty' } },
    { tool: 'submit', args: { findings: [] } },
  ];
  let calls = 0;
  const result = await runCase(
    firstCase(),
    options(async () => nativeResponse(commands[calls++])),
  );
  assert.equal(result.classification, 'model_fail');
  assert.equal(result.structural_corrections, 0);
  assert.equal(result.turns, 2);
  assert.equal(result.actions, 2);
  assert.equal(result.transcript[0].result.ok, false);
  assert.equal(result.transcript[0].result.error.code, 'unknown_user');
});

test('provider, served-model, missing-usage, and invalid-native failures are distinct and never retried', async () => {
  const { runCase } = await runner();
  const item = firstCase();
  const scenarios = [
    {
      request: async () => {
        throw new Error('offline');
      },
      classification: 'provider_error',
      reason: /transport/u,
    },
    {
      request: async () => new Response('busy', { status: 429 }),
      classification: 'provider_error',
      reason: /http_429/u,
    },
    {
      request: async () => new Response('unauthorized', { status: 401 }),
      classification: 'invalid_native',
      reason: /http_401/u,
    },
    {
      request: async () => new Response('forbidden', { status: 403 }),
      classification: 'invalid_native',
      reason: /http_403/u,
    },
    {
      request: async () => new Response('gateway error', { status: 503 }),
      classification: 'provider_error',
      reason: /http_503/u,
    },
    {
      request: async () => nativeResponse({ tool: 'get_jobs' }, { servedModel: 'glm-5.3' }),
      classification: 'invalid_native',
      reason: /served-model/u,
    },
    {
      request: async () => new Response(JSON.stringify({ model, choices: [], usage: null })),
      classification: 'provider_error',
      reason: /usage/u,
    },
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    const result = await runCase(
      item,
      options(async (...args) => {
        calls++;
        return scenario.request(...args);
      }),
    );
    assert.equal(result.classification, scenario.classification);
    assert.match(result.reason, scenario.reason);
    assert.equal(calls, 1);
    assert.equal(result.actions, 0);
  }
  let calls = 0;
  const invalid = structuredClone(item);
  invalid.native.sources.grants[0].client_id = 'forged-client';
  const result = await runCase(
    invalid,
    options(async () => {
      calls++;
      return nativeResponse({ tool: 'get_jobs' });
    }),
  );
  assert.equal(result.classification, 'invalid_native');
  assert.equal(calls, 0);
});

test('provider assistant role and content shape cannot enter the correction history', async () => {
  const { runCase } = await runner();
  for (const message of [
    { role: 'user', content: null, tool_calls: [] },
    { role: 'assistant', content: { hidden: 'object' }, tool_calls: [] },
  ]) {
    let calls = 0;
    const result = await runCase(
      firstCase(),
      options(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            model,
            choices: [{ finish_reason: 'stop', message }],
            usage: { completion_tokens: 10 },
          }),
        );
      }),
    );
    assert.equal(result.classification, 'provider_error');
    assert.match(result.reason, /message-shape/u);
    assert.equal(result.structural_corrections, 0);
    assert.equal(calls, 1);
  }
});

test('completion and turn limits stop before another request or action', async () => {
  const { runCase } = await runner();
  for (const [tokens, expectedTurns] of [
    [8192, 8],
    [1, LIMITS.model_turns],
  ]) {
    let calls = 0;
    const result = await runCase(
      firstCase(),
      options(async () => {
        calls++;
        return nativeResponse({ tool: 'get_dashboard' }, { completionTokens: tokens });
      }),
    );
    assert.equal(result.classification, 'exhausted_budget');
    assert.equal(result.turns, expectedTurns);
    assert.equal(result.actions, expectedTurns);
    assert.equal(calls, expectedTurns);
    assert.ok(result.actions <= LIMITS.tool_actions);
    assert.ok(result.completion_tokens <= LIMITS.completion_tokens_total);
  }
  const tooMany = await runCase(
    firstCase(),
    options(async () => nativeResponse({ tool: 'get_jobs' }, { completionTokens: 8193 })),
  );
  assert.equal(tooMany.classification, 'exhausted_budget');
  assert.equal(tooMany.actions, 0);
  const caps = [];
  const partial = await runCase(
    firstCase(),
    options(async (_url, init) => {
      const cap = JSON.parse(init.body).max_completion_tokens;
      caps.push(cap);
      return nativeResponse(
        { tool: 'get_jobs' },
        { completionTokens: caps.length <= 8 ? 8000 : 1536 },
      );
    }),
  );
  assert.equal(partial.classification, 'exhausted_budget');
  assert.deepEqual(caps, [...Array(8).fill(8192), 1536]);
  assert.equal(partial.completion_tokens, LIMITS.completion_tokens_total);
});

test('valid but wrong response actions are scored model failures, not format failures', async () => {
  const { runCase } = await runner();
  let calls = 0;
  const result = await runCase(
    firstCase(),
    options(async () => {
      calls++;
      return nativeResponse({ tool: 'submit', args: { findings: [] } });
    }),
  );
  assert.equal(result.classification, 'model_fail');
  assert.equal(result.score.exact, false);
  assert.equal(result.turns, 1);
  assert.equal(result.actions, 1);
  assert.equal(calls, 1);
});

test('first-case checkpoint persists private raw and resumes unchanged in the same process', async () => {
  const { runFrozenScreen } = await runner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-raw-'));
  try {
    freezeCorpus(root);
    let calls = 0;
    let checkpoints = 0;
    const output = path.join(outputRoot, 'raw.json');
    const result = await runFrozenScreen({
      root,
      output,
      onFirstCaseCheckpoint: async (checkpoint) => {
        checkpoints++;
        assert.equal(calls, 1);
        assert.equal(checkpoint.completed_cases, 1);
        assert.equal(checkpoint.results[0].classification, 'model_fail');
        const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
        assert.equal(saved.results.length, 1);
        assert.equal(saved.results[0].raw_responses.length, 1);
      },
      ...options(async () => {
        calls++;
        return nativeResponse({ tool: 'submit', args: { findings: [] } });
      }),
    });
    assert.equal(checkpoints, 1);
    assert.equal(result.completed_cases, 36);
    assert.equal(result.next_case_index, 36);
    assert.equal(result.results.length, 36);
    assert.equal(calls, 36);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).results.length, 36);
    await assert.rejects(
      () =>
        runFrozenScreen({
          root,
          output,
          onFirstCaseCheckpoint: async () => {},
          ...options(async () => nativeResponse({ tool: 'get_jobs' })),
        }),
      /already exists/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('raw output rejects repository destinations including symlinked parents before a request', async () => {
  const { runFrozenScreen } = await runner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-link-'));
  try {
    freezeCorpus(root);
    const link = path.join(outputRoot, 'repo-link');
    const here = path.dirname(fileURLToPath(import.meta.url));
    fs.symlinkSync(here, link);
    for (const output of [
      path.join(here, 'forbidden-raw.json'),
      path.join(link, 'forbidden-raw.json'),
    ]) {
      let calls = 0;
      await assert.rejects(
        () =>
          runFrozenScreen({
            root,
            output,
            onFirstCaseCheckpoint: async () => {},
            ...options(async () => {
              calls++;
              return nativeResponse({ tool: 'get_jobs' });
            }),
          }),
        /outside.*repository|repository.*outside/u,
      );
      assert.equal(calls, 0);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('provider or invalid first cases halt before the checkpoint continuation gate', async () => {
  const { runFrozenScreen } = await runner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-halt-'));
  try {
    freezeCorpus(root);
    for (const [name, response, classification] of [
      ['provider', new Response('busy', { status: 429 }), 'provider_error'],
      [
        'invalid',
        nativeResponse({ tool: 'get_jobs' }, { servedModel: 'glm-5.3' }),
        'invalid_native',
      ],
    ]) {
      let calls = 0;
      let checkpoints = 0;
      const result = await runFrozenScreen({
        root,
        output: path.join(outputRoot, `${name}.json`),
        onFirstCaseCheckpoint: async () => {
          checkpoints++;
        },
        ...options(async () => {
          calls++;
          return response.clone();
        }),
      });
      assert.equal(result.completed_cases, 1);
      assert.equal(result.results[0].classification, classification);
      assert.equal(checkpoints, 0);
      assert.equal(calls, 1);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('manifest is pinned through the checkpoint and checked before the next request', async () => {
  const { runFrozenScreen } = await runner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-freeze-'));
  try {
    freezeCorpus(root);
    const output = path.join(outputRoot, 'raw.json');
    let calls = 0;
    let pinnedHash;
    const result = await runFrozenScreen({
      root,
      output,
      onFirstCaseCheckpoint: async (checkpoint) => {
        pinnedHash = checkpoint.manifest_sha256;
        fs.appendFileSync(path.join(root, 'manifest.json'), ' ');
      },
      ...options(async () => {
        calls++;
        return nativeResponse({ tool: 'submit', args: { findings: [] } });
      }),
    });
    assert.equal(calls, 1);
    assert.equal(result.completed_cases, 2);
    assert.equal(result.results[1].classification, 'invalid_native');
    assert.match(result.results[1].reason, /freeze-manifest-changed/u);
    const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(saved.manifest_sha256, pinnedHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('native and evaluator sidecar drift after checkpoint stops before a later provider request', async () => {
  const { runFrozenScreen } = await runner();
  for (const sidecar of ['native_path', 'key_path']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-sidecar-'));
    try {
      const manifest = freezeCorpus(root);
      let calls = 0;
      const result = await runFrozenScreen({
        root,
        output: path.join(outputRoot, 'raw.json'),
        onFirstCaseCheckpoint: async () => {
          fs.appendFileSync(path.join(root, manifest.cases[1][sidecar]), ' ');
        },
        ...options(async () => {
          calls++;
          return nativeResponse({ tool: 'submit', args: { findings: [] } });
        }),
      });
      assert.equal(calls, 1);
      assert.equal(result.completed_cases, 2);
      assert.equal(result.results[1].classification, 'invalid_native');
      assert.match(result.results[1].reason, /freeze.*changed/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test('private raw persistence removes temporary files after a write failure', async () => {
  const { runFrozenScreen } = await runner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-corpus-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-runner-write-'));
  const originalWrite = fs.writeFileSync;
  try {
    freezeCorpus(root);
    const output = path.join(outputRoot, 'raw.json');
    fs.writeFileSync = (target, ...args) => {
      if (typeof target === 'number') {
        throw new Error('synthetic disk write failure');
      }
      return originalWrite(target, ...args);
    };
    await assert.rejects(
      () =>
        runFrozenScreen({
          root,
          output,
          onFirstCaseCheckpoint: async () => {},
          ...options(async () => nativeResponse({ tool: 'submit', args: { findings: [] } })),
        }),
      /synthetic disk write failure/u,
    );
    assert.deepEqual(fs.readdirSync(outputRoot), ['raw.json']);
  } finally {
    fs.writeFileSync = originalWrite;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
