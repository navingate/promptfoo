import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const screen = await import('./screen.mjs').catch(() => ({}));

test('v7 screen binds the fresh grid and exact frozen detector reference', async () => {
  assert.equal(typeof screen.runScreen, 'function');
  assert.equal(screen.verifyBindings(), true);
  const manifest = JSON.parse(
    fs.readFileSync('plugins/cyber/benchmarks/f4-durable-consent/chain-v7/manifest.json', 'utf8'),
  );
  assert.equal(typeof manifest.source_sha256['defense/scripts/harness.mjs'], 'string');
  assert.equal(screen.gridFor().length, 36);
  const result = await screen.runScreen({ mockReference: true, quiet: true });
  assert.equal(result.summary.planned, 36);
  assert.equal(result.summary.attempted, 36);
  assert.equal(result.summary.screen_complete, true);
  assert.equal(result.summary.model, 'reference');
  assert.equal(result.summary.endpoint_id, 'local');
  assert.equal(result.summary.pass, 36);
  assert.equal(result.summary.invalid_run, 0);
  assert.equal(result.summary.provider_error, 0);
  assert.equal(result.summary.precision, 1);
  assert.equal(result.summary.recall, 1);
  for (const family of Object.values(result.summary.families ?? {})) {
    assert.equal(family.attempted, 9);
    assert.equal(family.exact, 9);
    assert.equal(family.tp, 27);
    assert.equal(family.fp, 0);
    assert.equal(family.fn, 0);
  }
  assert.equal(Object.keys(result.summary.families ?? {}).length, 4);
});

test('v7 transport changes only the pre-registered output cap and reasoning effort', async () => {
  assert.equal(typeof screen.transportRequest, 'function');
  let body;
  const request = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true };
  };
  await screen.transportRequest(request)('https://example.invalid', {
    body: JSON.stringify({
      model: '@cf/zai-org/glm-5.3',
      max_tokens: 8192,
      temperature: 0,
      stream: false,
      messages: [],
    }),
  });
  assert.equal(body.max_tokens, 16384);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0);
});

test('HTTP 429 halts the v7 screen without a physical retry', async () => {
  const output = path.join(os.tmpdir(), `f4-v7-http-halt-${process.pid}.json`);
  let calls = 0;
  try {
    const result = await screen.runScreen({
      output,
      quiet: true,
      slotAssigned: true,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
        CLOUDFLARE_API_KEY: 'synthetic-test-key',
      },
      request: async () => {
        calls += 1;
        return { status: 429, ok: false };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.summary.attempted, 1);
    assert.equal(result.summary.provider_error, 1);
    assert.equal(result.summary.screen_complete, false);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).results.length, 1);
    assert.equal(result.transport_attempts.length, 1);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test('two mocked fetch TypeErrors exhaust one case and persist redacted attempts', async () => {
  const output = path.join(os.tmpdir(), `f4-v7-transport-halt-${process.pid}.json`);
  let calls = 0;
  try {
    const result = await screen.runScreen({
      output,
      quiet: true,
      slotAssigned: true,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
        CLOUDFLARE_API_KEY: 'synthetic-test-key',
      },
      request: async () => {
        calls += 1;
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.summary.attempted, 1);
    assert.equal(result.summary.provider_error, 1);
    assert.equal(result.summary.screen_complete, false);
    assert.deepEqual(
      result.transport_attempts.map((attempt) => attempt.attempt),
      [1, 2],
    );
    const saved = fs.readFileSync(output, 'utf8');
    assert.equal(saved.includes('synthetic-test-key'), false);
    assert.equal(saved.includes('example.invalid'), false);
    assert.equal(JSON.parse(saved).transport_attempts.length, 2);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test('live v7 execution requires an explicit coordinator slot flag', async () => {
  await assert.rejects(
    screen.runScreen({ output: path.join(os.tmpdir(), 'f4-v7-not-released.json') }),
    /assigned Cloudflare slot/u,
  );
});
