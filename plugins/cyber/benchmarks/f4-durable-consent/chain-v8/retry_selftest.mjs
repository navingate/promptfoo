import assert from 'node:assert/strict';
import test from 'node:test';

import { pacedRequest } from '../chain-cloudflare-v3/pace.mjs';

const retryModule = await import('./retry.mjs').catch(() => ({}));

test('one TypeError retry keeps the same logical request and redacts diagnostics', async () => {
  assert.equal(typeof retryModule.retryTypeErrorRequest, 'function');
  const init = {
    body: JSON.stringify({ messages: [{ content: 'synthetic-secret' }] }),
    headers: { authorization: 'Bearer synthetic-secret' },
  };
  const seen = [];
  const request = async (_url, attemptInit) => {
    seen.push(attemptInit);
    if (seen.length === 1) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    }
    return { status: 200, ok: true };
  };
  const retry = retryModule.retryTypeErrorRequest(request);
  const response = await retry('https://example.invalid', init);
  assert.equal(response.status, 200);
  assert.equal(seen.length, 2);
  assert.strictEqual(seen[0], init);
  assert.strictEqual(seen[1], init);
  assert.deepEqual(
    retry.diagnostics.map((event) => [event.logical_request, event.attempt, event.outcome]),
    [
      [1, 1, 'transport_error'],
      [1, 2, 'response'],
    ],
  );
  assert.equal(retry.diagnostics[0].cause_code, 'ECONNRESET');
  assert.equal(JSON.stringify(retry.diagnostics).includes('synthetic-secret'), false);
  assert.equal(JSON.stringify(retry.diagnostics).includes('example.invalid'), false);
});

test('HTTP 429 and non-TypeError failures are not retried', async () => {
  let httpCalls = 0;
  const http = retryModule.retryTypeErrorRequest(async () => {
    httpCalls += 1;
    return { status: 429, ok: false };
  });
  assert.equal((await http('https://example.invalid', {})).status, 429);
  assert.equal(httpCalls, 1);

  let otherCalls = 0;
  const other = retryModule.retryTypeErrorRequest(async () => {
    otherCalls += 1;
    const error = new Error('other failure');
    error.name = 'Bearer synthetic-secret';
    throw error;
  });
  await assert.rejects(other('https://example.invalid', {}), /other failure/);
  assert.equal(otherCalls, 1);
  assert.equal(JSON.stringify(other.diagnostics).includes('synthetic-secret'), false);
});

test('two TypeErrors exhaust the same logical request after paced physical starts', async () => {
  let time = 0;
  const starts = [];
  const request = async () => {
    starts.push(time);
    throw new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } });
  };
  const pacedStart = pacedRequest(async () => {}, {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  const retry = retryModule.retryTypeErrorRequest(request, {
    beforeAttempt: async () => pacedStart(),
  });
  await assert.rejects(retry('https://example.invalid', {}), TypeError);
  assert.deepEqual(starts, [0, 5000]);
  assert.equal(retry.diagnostics.length, 2);
  assert.equal(retry.diagnostics[1].outcome, 'transport_error');
});

test('a pacing failure is not treated as an underlying fetch TypeError', async () => {
  let fetchCalls = 0;
  const retry = retryModule.retryTypeErrorRequest(
    async () => {
      fetchCalls += 1;
      return { status: 200 };
    },
    {
      beforeAttempt: async () => {
        throw new TypeError('pacing failed');
      },
    },
  );
  await assert.rejects(retry('https://example.invalid', {}), /pacing failed/u);
  assert.equal(fetchCalls, 0);
  assert.equal(retry.diagnostics.length, 0);
});

test('a TypeError while inspecting a response is not retried as a fetch failure', async () => {
  let calls = 0;
  const retry = retryModule.retryTypeErrorRequest(async () => {
    calls += 1;
    return {
      get status() {
        throw new TypeError('response inspection failed');
      },
    };
  });
  await assert.rejects(retry('https://example.invalid', {}), /response inspection failed/u);
  assert.equal(calls, 1);
});

test('an aborted logical request never starts a second fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  const retry = retryModule.retryTypeErrorRequest(async () => {
    calls += 1;
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    throw new TypeError('fetch failed');
  });
  await assert.rejects(retry('https://example.invalid', { signal: controller.signal }), TypeError);
  assert.equal(calls, 1);
});

test('deadline expiry during retry pacing prevents the second physical attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  let starts = 0;
  const retry = retryModule.retryTypeErrorRequest(
    async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    },
    {
      beforeAttempt: async () => {
        starts += 1;
        if (starts === 2) {
          controller.abort(new DOMException('deadline', 'TimeoutError'));
        }
      },
    },
  );
  await assert.rejects(retry('https://example.invalid', { signal: controller.signal }));
  assert.equal(starts, 2);
  assert.equal(calls, 1);
});
