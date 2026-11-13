import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSTIC_MAX_TOKENS,
  DIAGNOSTIC_SEED,
  runLow16Diagnostic,
  withLowReasoning,
} from './cloudflare-glm53-low16-diagnostic.mjs';
import { screenSettings } from './cloudflare-glm53-screen.mjs';

test('low reasoning transform preserves benchmark request fields', async () => {
  let sent;
  const fetchImpl = withLowReasoning(async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true };
  });
  const original = {
    model: '@cf/zai-org/glm-5.3',
    messages: [{ role: 'user', content: 'fixture' }],
    temperature: 0,
    max_tokens: 16384,
    stream: false,
  };
  await fetchImpl('https://example.invalid', { body: JSON.stringify(original) });
  assert.deepEqual(sent, { ...original, reasoning_effort: 'low' });
  assert.equal(DIAGNOSTIC_SEED, 9751);
  assert.equal(DIAGNOSTIC_MAX_TOKENS, 16384);
});

test('synthetic 429 remains a provider error on one excluded case', async () => {
  let requests = 0;
  const cfg = {
    ...screenSettings({
      CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
      CLOUDFLARE_API_KEY: 'fixture',
    }),
    fetchImpl: async (_url, options) => {
      requests += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.reasoning_effort, 'low');
      assert.equal(body.max_tokens, 16384);
      return { status: 429, ok: false };
    },
  };
  const report = await runLow16Diagnostic(cfg);
  assert.equal(requests, 1);
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.provider_error, 1);
  assert.equal(report.summary.valid_output_runs, 0);
  assert.equal(report.results[0].classification, 'provider_error');
  assert.equal(report.excluded_from_scored_grid, true);
});
