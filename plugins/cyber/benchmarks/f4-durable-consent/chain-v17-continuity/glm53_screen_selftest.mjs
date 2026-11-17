import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { produceContinuity, referenceContinuity } from './continuity.mjs';
import { buildRequest, cloudflareConfig, MODEL_ID, runCase } from './glm53_screen.mjs';

const fakeEnv = {
  CLOUDFLARE_OPENAI_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/test/ai/v1',
  CLOUDFLARE_API_KEY: 'test-token-do-not-write',
};

test('Cloudflare request is pinned to HTTPS, model, settings, and cache bypass', () => {
  const config = cloudflareConfig(fakeEnv);
  assert.equal(config.endpoint, `${fakeEnv.CLOUDFLARE_OPENAI_BASE_URL}/chat/completions`);
  const request = buildRequest('synthetic prompt', config);
  assert.equal(request.headers.authorization, 'Bearer test-token-do-not-write');
  assert.equal(request.headers['cf-aig-skip-cache'], 'true');
  const body = JSON.parse(request.body);
  assert.equal(body.model, MODEL_ID);
  assert.equal(body.temperature, 0);
  assert.equal(body.reasoning_effort, 'max');
  assert.equal(body.max_completion_tokens, 16384);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'synthetic prompt' }]);
  const low = JSON.parse(buildRequest('synthetic prompt', config, 'low').body);
  assert.equal(low.reasoning_effort, 'low');
  assert.equal(low.max_completion_tokens, 16384);
  for (const env of [
    { ...fakeEnv, CLOUDFLARE_OPENAI_BASE_URL: 'http://api.cloudflare.com/ai/v1' },
    { ...fakeEnv, CLOUDFLARE_OPENAI_BASE_URL: 'https://example.com/ai/v1' },
    { ...fakeEnv, CLOUDFLARE_API_KEY: '' },
  ]) {
    assert.throws(() => cloudflareConfig(env));
  }
});

test('one model request scores exact and persists evidence without the token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-glm53-screen-test-'));
  try {
    const { episode } = produceContinuity({ seed: 85117, profile: 'both-live' });
    const { plan } = referenceContinuity(episode);
    let calls = 0;
    const request = async (_url, options) => {
      calls += 1;
      assert.equal(
        JSON.parse(options.body).messages[0].content.includes(episode.alert.alert_id),
        true,
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: MODEL_ID,
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    };
    const result = await runCase({ index: 0, env: fakeEnv, request, outputDir: directory });
    assert.equal(calls, 1);
    assert.equal(result.status, 'scored');
    assert.equal(result.score.exact, true);
    assert.equal(
      result.prompt_sha256,
      '85f1a6dbb90e792bafc43503af289b5ae78e77686ee28b4dbe96b2064019e8d7',
    );
    assert.equal(fs.readdirSync(directory).length >= 3, true);
    for (const file of fs.readdirSync(directory)) {
      assert.equal(
        fs.readFileSync(path.join(directory, file), 'utf8').includes(fakeEnv.CLOUDFLARE_API_KEY),
        false,
      );
    }
    await assert.rejects(() => runCase({ index: 0, env: fakeEnv, request, outputDir: directory }));
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('served-model mismatch and malformed content stay separate from scored misses', async () => {
  for (const [model, content, expected] of [
    ['unexpected-model', '[{"tool":"submit","args":{}}]', 'provider_error'],
    [MODEL_ID, 'not json', 'format_error'],
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-glm53-screen-test-'));
    try {
      const request = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          model,
          choices: [{ finish_reason: 'stop', message: { content } }],
        }),
      });
      const result = await runCase({ index: 0, env: fakeEnv, request, outputDir: directory });
      assert.equal(result.status, expected);
      assert.equal(result.score, null);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('low-reasoning variant uses separate immutable case artifacts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-glm53-screen-test-'));
  try {
    const request = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: MODEL_ID,
        choices: [{ finish_reason: 'stop', message: { content: '[{"tool":"submit","args":{}}]' } }],
      }),
    });
    const result = await runCase({
      index: 3,
      variant: 'low',
      env: fakeEnv,
      request,
      outputDir: directory,
    });
    assert.equal(result.status, 'scored');
    assert.equal(result.settings.reasoning_effort, 'low');
    assert.equal(fs.existsSync(path.join(directory, 'f4-v17-glm53-low-e3.result.json')), true);
    assert.equal(fs.existsSync(path.join(directory, 'f4-v17-glm53-e3.result.json')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
