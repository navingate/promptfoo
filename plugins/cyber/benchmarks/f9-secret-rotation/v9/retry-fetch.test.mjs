import assert from 'node:assert/strict';
import test from 'node:test';

import { createRetryingPacedFetch, RETRY_DELAYS_MS } from './retry-fetch.mjs';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

const url = 'https://example.invalid/chat/completions';
const options = {
  method: 'POST',
  body: '{"model":"fixture","messages":[{"role":"user","content":"test"}]}',
};
const ok = { ok: true, status: 200 };

test('TypeError retry keeps the exact request body and paces every attempt', async () => {
  const clock = fakeClock();
  const bodies = [];
  const transport = createRetryingPacedFetch(
    async (_url, init) => {
      bodies.push(init.body);
      if (bodies.length === 1) {
        throw new TypeError('transient connection');
      }
      return ok;
    },
    { monotonicNow: clock.now, wallNow: clock.now, sleep: clock.sleep, getSlot: () => 'case-1' },
  );
  assert.equal(await transport.fetch(url, options), ok);
  assert.deepEqual(bodies, [options.body, options.body]);
  assert.deepEqual(
    transport.starts.map((x) => x.monotonic_ms),
    [0, 5000],
  );
  assert.deepEqual(
    transport.requests[0].transient_errors.map((x) => x.reason),
    ['TypeError'],
  );
  assert.equal(transport.requests[0].attempts, 2);
  assert.equal(transport.requests[0].slot, 'case-1');
});

test('429 retries the same logical request and preserves the fixed backoff policy', async () => {
  const clock = fakeClock();
  let calls = 0;
  const transport = createRetryingPacedFetch(
    async () => (++calls === 1 ? { ok: false, status: 429 } : ok),
    { monotonicNow: clock.now, wallNow: clock.now, sleep: clock.sleep },
  );
  assert.equal(await transport.fetch(url, options), ok);
  assert.equal(calls, 2);
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(transport.requests[0].transient_errors, [
    { attempt: 1, reason: 'http-429', backoff_ms: RETRY_DELAYS_MS[0] },
  ]);
  assert.deepEqual(
    transport.starts.map((x) => x.monotonic_ms),
    [0, 5000],
  );
});

test('retry exhaustion stops at seven attempts without replacing the logical request', async () => {
  const clock = fakeClock();
  const transport = createRetryingPacedFetch(
    async () => {
      throw new TypeError('offline');
    },
    { monotonicNow: clock.now, wallNow: clock.now, sleep: clock.sleep },
  );
  await assert.rejects(transport.fetch(url, options), TypeError);
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0].attempts, 7);
  assert.equal(transport.requests[0].transient_errors.length, 7);
  assert.equal(transport.requests[0].outcome, 'exhausted-TypeError');
  assert.equal(transport.starts.length, 7);
});

test('non-transient response and error are not retried', async () => {
  for (const response of [
    { ok: false, status: 401 },
    { ok: false, status: 503 },
  ]) {
    const clock = fakeClock();
    const transport = createRetryingPacedFetch(async () => response, {
      monotonicNow: clock.now,
      wallNow: clock.now,
      sleep: clock.sleep,
    });
    assert.equal(await transport.fetch(url, options), response);
    assert.equal(transport.requests[0].attempts, 1);
  }
  const clock = fakeClock();
  const transport = createRetryingPacedFetch(
    async () => {
      throw new SyntaxError('bad');
    },
    { monotonicNow: clock.now, wallNow: clock.now, sleep: clock.sleep },
  );
  await assert.rejects(transport.fetch(url, options), SyntaxError);
  assert.equal(transport.requests[0].attempts, 1);
});

test('request wall limit stops retry before another model attempt', async () => {
  const clock = fakeClock();
  const transport = createRetryingPacedFetch(
    async () => {
      throw new TypeError('offline');
    },
    { monotonicNow: clock.now, wallNow: clock.now, sleep: clock.sleep, requestWallMs: 6000 },
  );
  await assert.rejects(transport.fetch(url, options), /request wall limit/);
  assert.equal(transport.requests[0].attempts, 2);
  assert.equal(transport.starts.length, 2);
  assert.equal(transport.requests[0].outcome, 'request-wall-limit');
});
