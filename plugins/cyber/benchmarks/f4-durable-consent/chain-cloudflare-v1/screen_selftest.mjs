import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { modelCall } from '../chain-v4/runner.mjs';
import {
  classifyLegacyFailure,
  cloudflareConfig,
  gridFor,
  MODEL_ID,
  runScreen,
  summarize,
  verifyFrozenBindings,
} from './screen.mjs';

test('the Cloudflare screen binds unchanged F4 source, captures, and prompts', () => {
  assert.equal(verifyFrozenBindings(), true);
  for (const mode of ['offense', 'defense', 'stage']) {
    assert.equal(gridFor(mode).length, 36);
    assert.equal(new Set(gridFor(mode).map(({ seed, family }) => `${seed}/${family}`)).size, 36);
  }
});

test('the reused model transport rejects a served-model echo mismatch', async () => {
  const response = await modelCall(
    [],
    { endpoint: 'https://gateway.example/v1', model: MODEL_ID },
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'different-model',
        choices: [{ message: { content: '{"tool":"submit","args":{}}' }, finish_reason: 'stop' }],
      }),
    }),
  );
  assert.equal(response.issue, 'invalid_run');
  assert.equal(response.reason, 'served-model-echo-mismatch');
});

test('one mocked 401 stops before opening concurrent defense requests', async () => {
  const output = path.join(os.tmpdir(), `f4-cf53-auth-selftest-${process.pid}.json`);
  let requests = 0;
  try {
    const { summary } = await runScreen({
      mode: 'defense',
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
        CLOUDFLARE_API_KEY: 'test-only',
      },
      request: async () => {
        requests += 1;
        return { ok: false, status: 401 };
      },
    });
    assert.equal(requests, 1);
    assert.equal(summary.attempted, 1);
    assert.equal(summary.invalid_run, 1);
    assert.equal(summary.exact, 0);
    assert.equal(summary.screen_complete, false);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test('only Cloudflare credentials configure the live model', () => {
  assert.throws(() => cloudflareConfig({ AWS_BASE_URL: 'https://aws.example', AWS_API_KEY: 'x' }));
  const config = cloudflareConfig({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://gateway.example/v1',
    CLOUDFLARE_API_KEY: 'test-only',
  });
  assert.equal(config.endpoint, 'https://gateway.example/v1');
  assert.equal(config.apiKey, 'test-only');
  assert.equal(config.model, MODEL_ID);
});

test('legacy offense authentication failure is an invalid run and does not fabricate a score', () => {
  assert.deepEqual(
    classifyLegacyFailure(
      { seed: 10021, family: 'tenant-boundary-filter' },
      1,
      'gateway authentication failed (401)',
    ),
    {
      spec: { seed: 10021, family: 'tenant-boundary-filter' },
      classification: 'invalid_run',
      reason: 'gateway-auth-401',
      score: null,
      turns: 0,
      actions: 0,
    },
  );
});

test('summary separates valid defense maps, format failures, and provider errors', () => {
  const summary = summarize(
    [
      {
        classification: 'pass',
        score: { valid_output: true, tp: 1, fp: 0, fn: 0, fp_on_survivor: 0, fp_on_approved: 0 },
      },
      {
        classification: 'model_fail',
        score: { valid_output: true, tp: 0, fp: 2, fn: 1, fp_on_survivor: 2, fp_on_approved: 0 },
      },
      { classification: 'format_fail', score: { valid_output: false } },
      { classification: 'provider_error', score: { valid_output: false } },
    ],
    'defense',
  );
  assert.equal(summary.attempted, 4);
  assert.equal(summary.screen_complete, false);
  assert.equal(summary.exact, 1);
  assert.equal(summary.valid_output_batches, 2);
  assert.equal(summary.tp, 1);
  assert.equal(summary.fp, 2);
  assert.equal(summary.fn, 1);
  assert.equal(summary.fp_on_survivor, 2);
  assert.equal(summary.format_fail, 1);
  assert.equal(summary.provider_error, 1);
});
