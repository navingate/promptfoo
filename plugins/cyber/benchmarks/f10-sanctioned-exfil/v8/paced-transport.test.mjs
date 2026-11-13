import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_REQUEST_GAP_MS, makePacedRequest } from './paced-transport.mjs';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

const cfg = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-token',
  model: '@cf/zai-org/glm-5.3',
  maxTokens: 8192,
  timeoutMs: 300000,
  screenDeadlineMs: 600000,
};
const messages = [{ role: 'user', content: 'test' }];
const ok = {
  ok: true,
  status: 200,
  json: async () => ({
    model: '@cf/zai-org/glm-5.3',
    choices: [{ message: { content: '{"tool":"catalog"}' }, finish_reason: 'stop' }],
  }),
};

test('all request starts, including separate logical calls, are at least five seconds apart', async () => {
  const clock = fakeClock();
  const bodies = [];
  const transport = makePacedRequest({
    fetchFn: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return ok;
    },
    sleepFn: clock.sleep,
    monotonicNow: clock.now,
    wallNow: clock.now,
  });
  assert.equal((await transport.request(messages, cfg)).kind, 'ok');
  assert.equal((await transport.request(messages, cfg)).kind, 'ok');
  assert.deepEqual(
    transport.starts.map((entry) => entry.monotonic_ms),
    [0, MIN_REQUEST_GAP_MS],
  );
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.deepEqual(
    transport.responses.map((entry) => entry.finish_reason),
    ['stop', 'stop'],
  );
});

test('a transient 429 retry is paced before the frozen transport retries it', async () => {
  const clock = fakeClock();
  let attempts = 0;
  const transport = makePacedRequest({
    fetchFn: async () => {
      attempts += 1;
      return attempts === 1 ? { ok: false, status: 429 } : ok;
    },
    sleepFn: clock.sleep,
    monotonicNow: clock.now,
    wallNow: clock.now,
  });
  const result = await transport.request(messages, cfg);
  assert.equal(result.kind, 'ok');
  assert.equal(result.transport.attempts, 2);
  assert.deepEqual(result.transport.transient_errors, ['http_429']);
  assert.deepEqual(
    transport.starts.map((entry) => entry.monotonic_ms),
    [0, MIN_REQUEST_GAP_MS],
  );
  assert.deepEqual(transport.responses[0].transport.transient_errors, ['http_429']);
});

test('low reasoning is confined to an explicit diagnostic request body', async () => {
  const clock = fakeClock();
  let body;
  const transport = makePacedRequest({
    reasoningEffort: 'low',
    fetchFn: async (_url, init) => {
      body = JSON.parse(init.body);
      return ok;
    },
    sleepFn: clock.sleep,
    monotonicNow: clock.now,
    wallNow: clock.now,
  });
  assert.equal((await transport.request(messages, { ...cfg, maxTokens: 16384 })).kind, 'ok');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 16384);
  assert.deepEqual(body.messages, messages);
  assert.throws(() => makePacedRequest({ minGapMs: 4000 }), /at least 5000/);
});
