import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { modelPrompt } from '../chain-v3/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { REQUEST_SETTINGS } from './config.mjs';
import { runScreen as runRawScreen } from './screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const model = REQUEST_SETTINGS.model_id;
const checks = [
  'created_this_run',
  'user_bound',
  'unauthorized',
  'reset_complete',
  'missed_by_query',
  'refresh_after_reset',
  'protected_call_after_reset',
  'export_read',
  'exact_value',
];

const runScreen = (options) => runRawScreen({ log: () => {}, ...options });

function nativeResult(spec, classification, responses = [], reason) {
  const success = classification === 'pass';
  return {
    spec,
    classification,
    ...(reason ? { reason } : {}),
    score: {
      success,
      checks: Object.fromEntries(checks.map((name) => [name, success])),
    },
    transcript: [
      { initial: { objective: 'fixture' }, system_prompt: modelPrompt('offense') },
      ...responses.map((response) => ({ response })),
    ],
    turns: ['provider_error', 'invalid_run'].includes(classification) ? 1 : responses.length,
    actions: classification === 'format_fail' ? 0 : responses.length,
  };
}

function providerResponse({
  status = 200,
  servedModel = model,
  content = '{"tool":"list-applications"}',
  finish = 'stop',
} = {}) {
  return new Response(
    JSON.stringify({
      model: servedModel,
      choices: [{ message: { content }, finish_reason: finish }],
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function requestBody() {
  return JSON.stringify({
    model,
    messages: [],
    temperature: 0,
    max_tokens: 16384,
    reasoning_effort: 'low',
    stream: false,
  });
}

function fakeChild(classify = () => 'model_fail') {
  return async ({ spec, request }) => {
    const response = await request('https://gateway.example/v1/chat/completions', {
      method: 'POST',
      body: requestBody(),
    });
    if (response.status === 401 || response.status === 403) {
      return { exitCode: 1, stderr: `gateway authentication failed (${response.status})` };
    }
    if (!response.ok) {
      const classification =
        response.status === 429 || response.status >= 500 ? 'provider_error' : 'invalid_run';
      return {
        exitCode: 0,
        capture: { results: [nativeResult(spec, classification, [], `http_${response.status}`)] },
      };
    }
    const body = await response.json();
    const content = body.choices[0].message.content;
    const finish = body.choices[0].finish_reason;
    const classification = classify(spec, { content, finish });
    const responseRecord = {
      raw: content,
      finish_reason: finish,
      served_model: body.model,
      usage: null,
      issue: null,
      reason: null,
    };
    return {
      exitCode: 0,
      capture: {
        results: [
          nativeResult(
            spec,
            classification,
            [responseRecord],
            classification === 'format_fail'
              ? finish === 'length'
                ? 'truncated-response'
                : 'no-json-tool-command'
              : undefined,
          ),
        ],
      },
    };
  };
}

function temporaryOutput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v18-screen-test-'));
  return { dir, output: path.join(dir, 'raw.json') };
}

function virtualTiming() {
  let now = 0;
  return {
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

async function withOutput(fn) {
  const paths = temporaryOutput();
  try {
    return await fn(paths);
  } finally {
    fs.rmSync(paths.dir, { recursive: true, force: true });
  }
}

test('served model echo must match the exact full model on every turn', async () => {
  await withOutput(async ({ output }) => {
    let spawned = 0;
    const result = await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      },
      request: async () => providerResponse({ servedModel: 'glm-5.3' }),
      spawnCase: async (options) => {
        spawned += 1;
        return await fakeChild()(options);
      },
    });
    assert.equal(spawned, 1);
    assert.equal(result.summary.attempted, 1);
    assert.equal(result.summary.invalid_run, 1);
    assert.equal(result.summary.scorable, 0);
    assert.equal(result.results[0].reason, 'served-model-echo-mismatch');
    const raw = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(raw.results[0].transport.requests[0].served_model, 'glm-5.3');
    assert.equal(
      raw.results[0].native_result.transcript[1].response.raw,
      '{"tool":"list-applications"}',
    );
  });
});

for (const status of [401, 403]) {
  test(`${status} authentication failure halts as invalid without retry or replacement`, async () => {
    await withOutput(async ({ output }) => {
      let requests = 0;
      let spawned = 0;
      const result = await runScreen({
        output,
        env: {
          CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
          CLOUDFLARE_API_KEY: 'fixture',
        },
        request: async () => {
          requests += 1;
          return providerResponse({ status });
        },
        spawnCase: async (options) => {
          spawned += 1;
          return await fakeChild()(options);
        },
      });
      assert.equal(requests, 1);
      assert.equal(spawned, 1);
      assert.equal(result.summary.attempted, 1);
      assert.equal(result.summary.invalid_run, 1);
      assert.equal(result.summary.screen_complete, false);
      assert.equal(result.results[0].reason, `gateway-auth-${status}`);
    });
  });
}

for (const status of [429, 500, 503]) {
  test(`${status} provider failure halts without retry or replacement`, async () => {
    await withOutput(async ({ output }) => {
      let requests = 0;
      let spawned = 0;
      const result = await runScreen({
        output,
        env: {
          CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
          CLOUDFLARE_API_KEY: 'fixture',
        },
        request: async () => {
          requests += 1;
          return providerResponse({ status });
        },
        spawnCase: async (options) => {
          spawned += 1;
          return await fakeChild()(options);
        },
      });
      assert.equal(requests, 1);
      assert.equal(spawned, 1);
      assert.equal(result.summary.attempted, 1);
      assert.equal(result.summary.provider_error, 1);
      assert.equal(result.summary.scorable, 0);
      assert.equal(result.summary.screen_complete, false);
    });
  });
}

for (const scenario of [
  {
    name: 'non-JSON command',
    content: 'plain prose',
    finish: 'stop',
    reason: 'no-json-tool-command',
  },
  {
    name: 'truncated response',
    content: '{"tool":',
    finish: 'length',
    reason: 'truncated-response',
  },
]) {
  test(`${scenario.name} is attempted and non-scorable format failure`, async () => {
    await withOutput(async ({ output }) => {
      let calls = 0;
      const result = await runScreen({
        output,
        env: {
          CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
          CLOUDFLARE_API_KEY: 'fixture',
        },
        request: async () => {
          calls += 1;
          return providerResponse(calls === 1 ? scenario : {});
        },
        spawnCase: fakeChild((_spec, { content, finish }) =>
          finish === 'length' || content === 'plain prose' ? 'format_fail' : 'model_fail',
        ),
        ...virtualTiming(),
      });
      assert.equal(calls, 36);
      assert.equal(result.summary.attempted, 36);
      assert.equal(result.summary.format_fail, 1);
      assert.equal(result.summary.parseable, 35);
      assert.equal(result.summary.scorable, 35);
      assert.equal(result.summary.screen_complete, true);
      assert.equal(result.results[0].reason, scenario.reason);
    });
  });
}

test('request starts are paced across turns and child process boundaries', async () => {
  await withOutput(async ({ output }) => {
    let now = 1000;
    const starts = [];
    let children = 0;
    const result = await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      },
      request: async () => {
        starts.push(now);
        return providerResponse({ status: starts.length === 3 ? 429 : 200 });
      },
      spawnCase: async ({ spec, request }) => {
        children += 1;
        const first = await request('https://gateway.example/v1/chat/completions', {
          body: requestBody(),
        });
        if (children === 1) {
          const second = await request('https://gateway.example/v1/chat/completions', {
            body: requestBody(),
          });
          const responses = await Promise.all([first.json(), second.json()]);
          return {
            exitCode: 0,
            capture: {
              results: [
                nativeResult(
                  spec,
                  'model_fail',
                  responses.map((body) => ({
                    raw: body.choices[0].message.content,
                    served_model: body.model,
                    finish_reason: body.choices[0].finish_reason,
                  })),
                ),
              ],
            },
          };
        }
        return {
          exitCode: 0,
          capture: { results: [nativeResult(spec, 'provider_error', [], 'http_429')] },
        };
      },
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    assert.deepEqual(starts, [1000, 6000, 11000]);
    assert.equal(children, 2);
    assert.equal(result.summary.attempted, 2);
    assert.equal(result.summary.provider_error, 1);
  });
});

test('an output path inside the repository is rejected before any request', async () => {
  const output = path.join(
    repoRoot,
    'plugins/cyber/benchmarks/f4-durable-consent/chain-v18-offense/raw.json',
  );
  let called = false;
  await assert.rejects(
    runScreen({
      output,
      request: async () => {
        called = true;
      },
      spawnCase: fakeChild(),
    }),
    /outside the repository/u,
  );
  assert.equal(called, false);
  assert.equal(fs.existsSync(output), false);
});

test('a symlinked output directory into the repository is rejected', async () => {
  await withOutput(async ({ dir }) => {
    const link = path.join(dir, 'repo');
    fs.symlinkSync(repoRoot, link, 'dir');
    await assert.rejects(
      runScreen({
        output: path.join(link, 'raw.json'),
        request: async () => {},
        spawnCase: fakeChild(),
      }),
      /outside the repository/u,
    );
  });
});

test('the child receives only the Cloudflare binding and one-case v3 runner arguments', async () => {
  await withOutput(async ({ output }) => {
    let observed;
    await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1/',
        CLOUDFLARE_API_KEY: 'fixture',
        AWS_BASE_URL: 'https://wrong.example',
      },
      request: async () => providerResponse({ status: 429 }),
      spawnCase: async (options) => {
        observed = options;
        return await fakeChild()(options);
      },
    });
    assert.deepEqual(observed.args.slice(0, 3), [
      `--import=${path.join(here, 'audit.mjs')}`,
      `--import=${path.resolve(here, '../chain-cloudflare-v3/offense-preload.mjs')}`,
      path.resolve(here, '../chain-v3/runner.mjs'),
    ]);
    assert.deepEqual(observed.args.slice(3, 9), [
      '--mode',
      'offense',
      '--seeds',
      '41021',
      '--families',
      FAMILIES[0],
    ]);
    assert.equal(observed.env.CYBER_SUT_ENDPOINT, 'https://gateway.example/v1');
    assert.equal(observed.env.CLOUDFLARE_OPENAI_BASE_URL, 'https://gateway.example/v1');
    assert.equal(observed.env.CYBER_API_KEY, 'fixture');
    assert.equal(observed.env.CYBER_MODEL, model);
    assert.equal(observed.env.CYBER_ENDPOINT_ID, REQUEST_SETTINGS.endpoint_id);
    assert.equal(observed.env.AWS_BASE_URL, undefined);
    assert.equal(observed.env.OPENAI_API_KEY, undefined);
    assert.equal(observed.env.NODE_OPTIONS, undefined);
  });
});

test('private raw output is atomic, mode 0600, and retains hashes without logging bodies', async () => {
  await withOutput(async ({ output }) => {
    const emitted = [];
    const result = await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      },
      request: async () => providerResponse({ status: 429 }),
      spawnCase: fakeChild(),
      log: (line) => emitted.push(line),
    });
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(
      fs.readdirSync(path.dirname(output)).filter((name) => name.includes('.tmp')).length,
      0,
    );
    const raw = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.deepEqual(raw.summary, result.summary);
    assert.deepEqual(
      raw.results[0].score?.checks,
      nativeResult(raw.results[0].spec, 'provider_error').score.checks,
    );
    assert.equal(raw.results[0].transcript[0].system_prompt, modelPrompt('offense'));
    const evidence = raw.results[0].transport.requests[0];
    assert.equal(evidence.requested_model, model);
    assert.equal(evidence.served_model, model);
    assert.match(evidence.request_sha256, /^[a-f0-9]{64}$/u);
    assert.match(evidence.response_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(
      evidence.request_sha256,
      crypto.createHash('sha256').update(requestBody()).digest('hex'),
    );
    assert.ok(emitted.every((line) => !line.includes('fixture') && !line.includes('choices')));
  });
});

test('the 36-case summary separates attempted, parseable, scorable, exact, and native stages', async () => {
  await withOutput(async ({ output }) => {
    let index = 0;
    const result = await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      },
      request: async () => providerResponse(),
      spawnCase: fakeChild(() => {
        index += 1;
        return index === 1 ? 'pass' : index === 2 ? 'format_fail' : 'model_fail';
      }),
      ...virtualTiming(),
    });
    assert.equal(result.summary.planned, 36);
    assert.equal(result.summary.attempted, 36);
    assert.equal(result.summary.parseable, 35);
    assert.equal(result.summary.scorable, 35);
    assert.equal(result.summary.exact, 1);
    assert.equal(result.summary.pass, 1);
    assert.equal(result.summary.model_fail, 34);
    assert.equal(result.summary.format_fail, 1);
    assert.equal(result.summary.stage_counts.exact_value, 1);
    assert.equal(result.summary.stage_counts.created_this_run, 1);
    assert.deepEqual(new Set(result.results.map(({ spec }) => spec.family)), new Set(FAMILIES));
  });
});

test('the unchanged native runner completes all 36 reference cases', async () => {
  await withOutput(async ({ output }) => {
    const { summary, results } = await runScreen({
      output,
      mockReference: true,
      log: () => {},
    });
    assert.equal(summary.attempted, 36);
    assert.equal(summary.exact, 36);
    assert.equal(summary.scorable, 36);
    assert.equal(summary.invalid_run, 0);
    assert.equal(
      results.every(({ score }) => checks.every((name) => score.checks[name])),
      true,
    );
  });
});

test('the audit preload sees the v3 preload’s rewritten request without a model call', async () => {
  await withOutput(async ({ dir }) => {
    const stub = path.join(dir, 'stub-fetch.mjs');
    const audit = path.join(dir, 'audit.jsonl');
    fs.writeFileSync(
      stub,
      `let tick = 0; let reads = 0; Date.now = () => { reads += 1; if (reads === 2) tick += 2; return tick; }; globalThis.setTimeout = (callback, ms) => { tick += ms; queueMicrotask(callback); }; globalThis.fetch = async () => new Response(JSON.stringify({ model: '${model}', choices: [{ message: { content: '{"tool":"list-applications"}' }, finish_reason: 'stop' }] }), { status: 200 });\n`,
    );
    fs.writeFileSync(audit, '', { mode: 0o600 });
    const originalBody = JSON.stringify({
      model,
      messages: [],
      temperature: 0,
      max_tokens: 8192,
      stream: false,
    });
    const command = spawnSync(
      process.execPath,
      [
        `--import=${stub}`,
        `--import=${path.join(here, 'audit.mjs')}`,
        `--import=${path.resolve(here, '../chain-cloudflare-v3/offense-preload.mjs')}`,
        '--input-type=module',
        '-e',
        `await fetch('https://gateway.example/v1/chat/completions', { body: ${JSON.stringify(originalBody)} }); await fetch('https://gateway.example/v1/chat/completions', { body: ${JSON.stringify(originalBody)} });`,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
          CLOUDFLARE_API_KEY: 'fixture',
          CYBER_SUT_ENDPOINT: 'https://gateway.example/v1',
          CYBER_API_KEY: 'fixture',
          CYBER_MODEL: model,
          F4_CF_SCORE_PRELOAD: '1',
          F4_V18_AUDIT_PRELOAD: '1',
          F4_V18_AUDIT_FILE: audit,
        },
      },
    );
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stdout, '');
    const events = fs.readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      events.map(({ event }) => event),
      ['start', 'response', 'start', 'response'],
    );
    assert.equal(events[0].request_settings.max_tokens, 16384);
    assert.equal(events[0].request_settings.reasoning_effort, 'low');
    assert.equal(events[0].requested_model, model);
    assert.equal(events[1].served_model, model);
    assert.ok(events[2].started_ms - events[0].started_ms >= 5000);
    assert.equal(fs.statSync(audit).mode & 0o777, 0o600);
  });
});

test('a transport audit with request starts too close is invalid', async () => {
  await withOutput(async ({ output }) => {
    const now = 0;
    let requests = 0;
    const result = await runScreen({
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      },
      request: async () => {
        requests += 1;
        return providerResponse();
      },
      spawnCase: fakeChild(),
      clock: () => now,
      sleep: async () => {},
      log: () => {},
    });
    assert.equal(requests, 2);
    assert.equal(result.summary.attempted, 2);
    assert.equal(result.summary.invalid_run, 1);
    assert.equal(result.results[1].reason, 'request-pace-violation');
  });
});
