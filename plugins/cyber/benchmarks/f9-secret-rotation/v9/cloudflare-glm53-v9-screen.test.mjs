import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEFENSE_SEEDS,
  OFFENSE_SEEDS,
  PILOT_SEED,
  runPacedScreen,
  SCREEN_VERSION,
  screenSettings,
} from './cloudflare-glm53-v9-screen.mjs';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

const preflight = {
  ok: true,
  status: 200,
  json: async () => ({
    model: '@cf/zai-org/glm-5.3',
    choices: [{ message: { content: 'PONG' }, finish_reason: 'stop' }],
  }),
};

test('v9 freezes untouched seeds and the same exact model configuration', () => {
  assert.equal(SCREEN_VERSION, 'f9-v9-cloudflare-glm53-retry-v1-low16');
  assert.deepEqual(
    [PILOT_SEED, OFFENSE_SEEDS[0], OFFENSE_SEEDS.at(-1), DEFENSE_SEEDS.at(-1)],
    [24901, 25001, 25012, 25003],
  );
});

test('a 429-exhausted case is logged, checkpointed, and stops without seed replacement', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-v9-wrapper-');
  const output = `${directory}/capture.json`;
  const clock = fakeClock();
  const bodies = [];
  const cfg = screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
  try {
    const report = await runPacedScreen('offense', cfg, output, {
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return bodies.length === 1 ? preflight : { ok: false, status: 429 };
      },
      transportOptions: {
        monotonicNow: clock.now,
        wallNow: clock.now,
        sleep: clock.sleep,
      },
    });
    assert.equal(report.status, 'halted-rate-limit');
    assert.equal(report.summary.assigned_cases, 36);
    assert.equal(report.summary.attempted_cases, 1);
    assert.equal(report.summary.provider_error, 1);
    assert.equal(report.transport_requests.length, 2);
    assert.equal(report.transport_requests[0].slot, 'preflight');
    assert.equal(report.transport_requests[1].attempts, 7);
    assert.equal(report.transport_requests[1].transient_errors.length, 7);
    assert.equal(report.transport_requests[1].outcome, 'exhausted-http-429');
    assert.equal(bodies.length, 8);
    assert.ok(bodies.every((body) => body.reasoning_effort === 'low'));
    assert.ok(bodies.slice(1).every((body) => body.max_tokens === 16384));
    assert.ok(bodies.slice(2).every((body) => JSON.stringify(body) === JSON.stringify(bodies[1])));
    const starts = report.request_starts.map((entry) => entry.monotonic_ms);
    assert.ok(starts.slice(1).every((start, index) => start - starts[index] >= 5000));
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).results.length, 1);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a TypeError-exhausted case stops with provider error and one assigned seed', async () => {
  const directory = fs.mkdtempSync('/tmp/f9-v9-wrapper-');
  const output = `${directory}/capture.json`;
  const clock = fakeClock();
  const cfg = screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
  let calls = 0;
  try {
    const report = await runPacedScreen('offense', cfg, output, {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return preflight;
        }
        throw new TypeError('offline');
      },
      transportOptions: {
        monotonicNow: clock.now,
        wallNow: clock.now,
        sleep: clock.sleep,
      },
    });
    assert.equal(report.status, 'halted-provider');
    assert.equal(report.summary.attempted_cases, 1);
    assert.equal(report.results[0].reason, 'TypeError');
    assert.equal(report.transport_requests[1].attempts, 7);
    assert.equal(calls, 8);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
