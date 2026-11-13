import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFENSE_SEEDS,
  EXACT_MODEL,
  OFFENSE_SEEDS,
  preflightCloudflare,
  runCloudflareScreen,
  SCREEN_VERSION,
  screenSettings,
} from './cloudflare-glm53-screen.mjs';

test('Cloudflare screen pins untouched seeds, HTTPS endpoint, and exact model', () => {
  assert.deepEqual(
    [OFFENSE_SEEDS[0], OFFENSE_SEEDS.at(-1), DEFENSE_SEEDS.at(-1)],
    [18001, 18012, 18003],
  );
  assert.equal(SCREEN_VERSION, 'f9-v7-cloudflare-glm53-v1');
  assert.equal(EXACT_MODEL, '@cf/zai-org/glm-5.3');
  assert.throws(
    () =>
      screenSettings({
        CLOUDFLARE_OPENAI_BASE_URL: 'http://example.invalid/v1',
        CLOUDFLARE_API_KEY: 'fixture',
      }),
    /HTTPS/u,
  );
  const cfg = screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
  assert.equal(cfg.model, EXACT_MODEL);
  assert.equal(cfg.endpointId, 'cloudflare-workers-ai-openai-compat');
});

test('401 in a synthetic transport is counted as auth invalidity, never model failure', async () => {
  let requests = 0;
  const cfg = {
    ...screenSettings({
      CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
      CLOUDFLARE_API_KEY: 'fixture',
    }),
    fetchImpl: async () => {
      requests += 1;
      return { status: 401, ok: false };
    },
  };
  const report = await runCloudflareScreen('defense', cfg);
  assert.equal(requests, 36);
  assert.equal(report.summary.total, 36);
  assert.equal(report.summary.valid_output_runs, 0);
  assert.equal(report.summary.invalid_run, 36);
  assert.equal(report.summary.provider_error, 0);
  assert.equal(report.provider_auth_errors, 36);
  assert.ok(
    report.results.every(
      (result) =>
        result.classification === 'invalid_run' &&
        result.reason === 'http-401' &&
        result.actions === 0,
    ),
  );
});

test('non-scored preflight stops after one synthetic 401', async () => {
  let requests = 0;
  const cfg = {
    ...screenSettings({
      CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
      CLOUDFLARE_API_KEY: 'fixture',
    }),
    fetchImpl: async () => {
      requests += 1;
      return { status: 401, ok: false };
    },
  };
  await assert.rejects(preflightCloudflare(cfg), /preflight invalid_run: http-401/u);
  assert.equal(requests, 1);
});

test('preflight rejects a different served-model echo before scoring', async () => {
  let requests = 0;
  const cfg = {
    ...screenSettings({
      CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
      CLOUDFLARE_API_KEY: 'fixture',
    }),
    fetchImpl: async () => {
      requests += 1;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          model: 'different-model',
          choices: [{ message: { content: 'PONG' } }],
        }),
      };
    },
  };
  await assert.rejects(preflightCloudflare(cfg), /served-model-echo-mismatch/u);
  assert.equal(requests, 1);
});
