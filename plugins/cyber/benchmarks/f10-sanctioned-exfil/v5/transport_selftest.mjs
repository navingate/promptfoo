import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runOffense } from './runner.mjs';
import { REQUEST_WALL_MS, RETRY_DELAYS_MS, requestChat } from './transport.mjs';

const cfg = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-only-key',
  model: 'zai.glm-5',
  maxTokens: 8192,
  timeoutMs: 300000,
};
const messages = [{ role: 'user', content: 'same transcript' }];
const good = (content = '{"tool":"catalog"}') =>
  new Response(
    JSON.stringify({
      model: 'zai.glm-5',
      choices: [{ message: { content }, finish_reason: 'stop' }],
    }),
    { status: 200 },
  );

test('transient retries preserve the exact request and process one successful response', async () => {
  const bodies = [];
  const delays = [];
  const sequence = [new TypeError('connection'), new Response('', { status: 503 }), good()];
  const result = await requestChat(messages, cfg, {
    fetchFn: async (_url, options) => {
      bodies.push(options.body);
      const next = sequence.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    sleepFn: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(result.kind, 'ok');
  assert.equal(result.text, '{"tool":"catalog"}');
  assert.deepEqual(result.transport, {
    attempts: 3,
    transient_errors: ['TypeError', 'http_503'],
  });
  assert.deepEqual(delays, RETRY_DELAYS_MS.slice(0, 2));
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(JSON.parse(bodies[0]).messages, messages);
});

test('all transient attempts exhausted yields only a provider error', async () => {
  let calls = 0;
  const delays = [];
  const result = await requestChat(messages, cfg, {
    fetchFn: async () => {
      calls += 1;
      throw new TypeError('connection');
    },
    sleepFn: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(calls, RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(delays, RETRY_DELAYS_MS);
  assert.equal(result.kind, 'provider_error');
  assert.equal(result.reason, 'TypeError');
  assert.equal(result.transport.attempts, calls);
});

test('authentication errors abort immediately', async () => {
  let calls = 0;
  await assert.rejects(
    requestChat(messages, cfg, {
      fetchFn: async () => {
        calls += 1;
        return new Response('', { status: 401 });
      },
      sleepFn: async () => {
        throw new Error('must not retry');
      },
    }),
    /authentication failed \(401\)/u,
  );
  assert.equal(calls, 1);
});

test('malformed provider responses are invalid runs, not retryable', async () => {
  let calls = 0;
  const result = await requestChat(messages, cfg, {
    fetchFn: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
    sleepFn: async () => {
      throw new Error('must not retry');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'invalid_run');
  assert.equal(result.reason, 'malformed-provider-response');
});

test('a transient failure resumes the same offense session without repeating a tool action', async () => {
  const bodies = [];
  const sequence = [good(), new TypeError('connection'), good('{"tool":"finish","args":{}}')];
  const request = (currentMessages, currentCfg) =>
    requestChat(currentMessages, currentCfg, {
      fetchFn: async (_url, options) => {
        bodies.push(options.body);
        const next = sequence.shift();
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
      sleepFn: async () => {},
    });
  const run = await runOffense(
    { seed: 11001, family: 'multi-identity-fanout' },
    { mock: false, maxTurns: 3 },
    cfg,
    request,
  );
  assert.equal(run.reason, 'finished-before-transfer');
  assert.equal(run.transcript.length, 2);
  assert.equal(run.transcript[0].results.length, 1);
  assert.equal(run.transcript[0].results[0].ok, true);
  assert.equal(run.transcript[1].results.length, 1);
  assert.equal(run.transcript[1].results[0].finished, true);
  assert.equal(run.transcript[1].transport.attempts, 2);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[1], bodies[2]);
  assert.equal(run.score.checks.completed_transfer, false);
});

test('logical request wall cap stops retries before an unbounded timeout chain', async () => {
  let now = 0;
  let calls = 0;
  const result = await requestChat(messages, cfg, {
    fetchFn: async () => {
      calls += 1;
      now = REQUEST_WALL_MS - 1000;
      throw new TypeError('connection');
    },
    sleepFn: async (ms) => {
      now += ms;
    },
    nowFn: () => now,
  });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'provider_error');
  assert.equal(result.reason, 'request-wall-limit');
  assert.equal(result.transport.attempts, 1);
});

test('screen deadline is stricter than the per-request wall cap', async () => {
  let now = 0;
  let calls = 0;
  const result = await requestChat(
    messages,
    { ...cfg, screenDeadlineMs: 1500 },
    {
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) {
          throw new TypeError('connection');
        }
        return good();
      },
      sleepFn: async (ms) => {
        now += ms;
      },
      nowFn: () => now,
    },
  );
  assert.equal(result.kind, 'ok');
  assert.equal(result.transport.attempts, 2);
  assert.equal(now, 1000);
});

test('an expired screen deadline stops an offense session before another model request', async () => {
  const run = await runOffense(
    { seed: 11001, family: 'multi-identity-fanout' },
    { mock: false, maxTurns: 3 },
    { ...cfg, screenDeadlineMs: 0 },
    async () => {
      throw new Error('must not request');
    },
  );
  assert.equal(run.classification, 'provider_error');
  assert.equal(run.reason, 'screen-wall-limit');
  assert.equal(run.transcript.length, 0);
});
