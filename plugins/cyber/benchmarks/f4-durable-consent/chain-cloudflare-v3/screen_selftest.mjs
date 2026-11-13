import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pacedRequest } from './pace.mjs';
import { gridFor, runScreen, transportRequest, verifyBindings } from './screen.mjs';

test('request pacing keeps at least five seconds between sends', async () => {
  let time = 1000;
  const sends = [];
  const paced = pacedRequest(
    async () => {
      sends.push(time);
      return { ok: true };
    },
    {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    },
  );
  await paced('https://gateway.example', {});
  await paced('https://gateway.example', {});
  assert.deepEqual(sends, [1000, 6000]);
});

test('new scored source and grids are bound before model calls', () => {
  assert.equal(verifyBindings(), true);
  const offense = gridFor('offense');
  assert.equal(offense.length, 36);
  assert.equal(new Set(offense.map(({ seed, family }) => `${seed}/${family}`)).size, 36);
  assert.ok(offense.every(({ seed }) => seed >= 13021 && seed <= 13029));
  assert.equal(gridFor('defense').length, 36);
  assert.equal(gridFor('stage').length, 36);
});

test('scored transport changes only 16k cap and low reasoning effort', async () => {
  const input = {
    model: '@cf/zai-org/glm-5.3',
    messages: [],
    temperature: 0,
    max_tokens: 8192,
    stream: false,
  };
  let observed;
  const request = transportRequest(async (_url, init) => {
    observed = JSON.parse(init.body);
    return { ok: false, status: 401 };
  });
  await request('https://gateway.example/v1/chat/completions', { body: JSON.stringify(input) });
  assert.deepEqual(observed, { ...input, max_tokens: 16384, reasoning_effort: 'low' });
  assert.equal(input.max_tokens, 8192);
});

test('a mocked first-case auth failure stops the new scored defense grid', async () => {
  const output = path.join(os.tmpdir(), `f4-cf53-v3-auth-selftest-${process.pid}.json`);
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
    assert.equal(summary.screen_complete, false);
  } finally {
    fs.rmSync(output, { force: true });
  }
});
