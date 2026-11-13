import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { screenSettings } from './cloudflare-glm53-screen.mjs';
import {
  createPacedFetch,
  DEFENSE_SEEDS,
  MIN_REQUEST_INTERVAL_MS,
  OFFENSE_SEEDS,
  PILOT_SEED,
  runPacedScreen,
  SCREEN_VERSION,
} from './cloudflare-glm53-v2-screen.mjs';

function fixtureCfg() {
  return screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
}

test('v2 uses fresh scored seeds and an excluded pilot', () => {
  assert.equal(SCREEN_VERSION, 'f9-v7-cloudflare-glm53-v2');
  assert.equal(MIN_REQUEST_INTERVAL_MS, 5000);
  assert.deepEqual(
    [PILOT_SEED, OFFENSE_SEEDS[0], OFFENSE_SEEDS.at(-1), DEFENSE_SEEDS.at(-1)],
    [9701, 19001, 19012, 19003],
  );
});

test('transport spaces request starts by at least five seconds', async () => {
  let clock = 0;
  const starts = [];
  const paced = createPacedFetch(
    async (_url, options) => {
      starts.push(clock);
      assert.ok(options.signal instanceof AbortSignal);
      return { status: 200 };
    },
    {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );
  await paced('https://example.invalid', {});
  await paced('https://example.invalid', {});
  await paced('https://example.invalid', {});
  assert.deepEqual(starts, [0, 5000, 10000]);
});

test('a synthetic 429 halts after one scored case and checkpoints privately', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-cf-v2-');
  const output = path.join(directory, 'capture.json');
  let requests = 0;
  try {
    const report = await runPacedScreen('offense', fixtureCfg(), output, {
      pacedFetch: async () => {
        requests += 1;
        return requests === 1
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
    assert.equal(requests, 2);
    assert.equal(report.status, 'halted-rate-limit');
    assert.equal(report.summary.assigned_cases, 36);
    assert.equal(report.summary.attempted_cases, 1);
    assert.equal(report.summary.provider_error, 1);
    assert.equal(report.summary.valid_output_runs, 0);
    assert.equal(report.results[0].reason, 'http-429');
    assert.equal(fs.statSync(output).mode & 0o077, 0);
    const persisted = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(persisted.status, 'halted-rate-limit');
    assert.equal(persisted.results.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a synthetic 401 stops at preflight with no scored case', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-cf-v2-');
  const output = path.join(directory, 'capture.json');
  let requests = 0;
  try {
    const report = await runPacedScreen('defense', fixtureCfg(), output, {
      pacedFetch: async () => {
        requests += 1;
        return { status: 401, ok: false };
      },
    });
    assert.equal(requests, 1);
    assert.equal(report.status, 'preflight-failed');
    assert.deepEqual(report.preflight, { kind: 'invalid_run', reason: 'http-401' });
    assert.equal(report.summary.attempted_cases, 0);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).status, 'preflight-failed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a truncated pilot remains a valid model failure and completes its grid', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-cf-v2-');
  const output = path.join(directory, 'capture.json');
  let requests = 0;
  try {
    const report = await runPacedScreen('pilot-offense', fixtureCfg(), output, {
      pacedFetch: async () => {
        requests += 1;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            model: '@cf/zai-org/glm-5.3',
            choices: [
              {
                message: { content: requests === 1 ? 'PONG' : '' },
                finish_reason: requests === 1 ? 'stop' : 'length',
              },
            ],
          }),
        };
      },
    });
    assert.equal(requests, 2);
    assert.equal(report.status, 'complete');
    assert.equal(report.summary.assigned_cases, 1);
    assert.equal(report.summary.attempted_cases, 1);
    assert.equal(report.summary.valid_output_runs, 1);
    assert.equal(report.summary.model_fail, 1);
    assert.equal(report.summary.truncated, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
