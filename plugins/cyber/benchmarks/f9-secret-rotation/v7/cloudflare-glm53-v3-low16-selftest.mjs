import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { screenSettings } from './cloudflare-glm53-screen.mjs';
import {
  DEFENSE_SEEDS,
  OFFENSE_SEEDS,
  runPacedScreen,
  SCREEN_VERSION,
} from './cloudflare-glm53-v3-low16-screen.mjs';

test('v3 freezes fresh seeds and a distinct model configuration', () => {
  assert.equal(SCREEN_VERSION, 'f9-v7-cloudflare-glm53-v3-low16');
  assert.deepEqual(
    [OFFENSE_SEEDS[0], OFFENSE_SEEDS.at(-1), DEFENSE_SEEDS.at(-1)],
    [22001, 22012, 22003],
  );
});

test('v3 sends low reasoning and 16k on scored requests, then halts on 429', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-cf-v3-');
  const output = `${directory}/capture.json`;
  const bodies = [];
  const cfg = screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
  try {
    const report = await runPacedScreen('offense', cfg, output, {
      pacedFetch: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return bodies.length === 1
          ? {
              status: 200,
              ok: true,
              json: async () => ({
                model: '@cf/zai-org/glm-5.3',
                choices: [{ message: { content: 'PONG' } }],
              }),
            }
          : { status: 429, ok: false };
      },
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[1].reasoning_effort, 'low');
    assert.equal(bodies[1].max_tokens, 16384);
    assert.equal(report.status, 'halted-rate-limit');
    assert.equal(report.summary.attempted_cases, 1);
    assert.equal(report.summary.provider_error, 1);
    assert.equal(report.max_tokens, 16384);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).results.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
