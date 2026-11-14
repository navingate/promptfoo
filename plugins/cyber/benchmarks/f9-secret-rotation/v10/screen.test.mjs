import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { inferGrant, inferRoute } from './offense.mjs';
import { DEFENSE_SEEDS, OFFENSE_SEEDS, runPacedScreen, screenSettings } from './screen.mjs';

const MODEL = '@cf/zai-org/glm-5.3';
const reply = (content, model = MODEL, finish_reason = 'stop') => ({
  ok: true,
  status: 200,
  json: async () => ({ model, choices: [{ message: { content }, finish_reason }] }),
});
function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}
const config = () =>
  screenSettings({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.invalid/v1',
    CLOUDFLARE_API_KEY: 'fixture',
  });
async function capture(mode, fakeFetch, extra = {}) {
  const dir = fs.mkdtempSync('/tmp/f9-v10-screen-');
  const output = `${dir}/capture.json`;
  const tick = clock();
  try {
    const report = await runPacedScreen(mode, config(), output, {
      fetchImpl: fakeFetch,
      transportOptions: { monotonicNow: tick.now, wallNow: tick.now, sleep: tick.sleep },
      ...extra,
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    return report;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('fresh assigned grid and exact model echo stop invalid run', async () => {
  assert.deepEqual(
    [OFFENSE_SEEDS[0], OFFENSE_SEEDS.at(-1), DEFENSE_SEEDS.at(-1)],
    [26001, 26012, 26003],
  );
  let calls = 0;
  const report = await capture('defense', async () =>
    reply('PONG', calls++ === 0 ? MODEL : 'wrong'),
  );
  assert.equal(report.status, 'halted-invalid');
  assert.equal(report.summary.assigned_cases, 36);
  assert.equal(report.summary.attempted_cases, 1);
  assert.equal(report.summary.invalid_run, 1);
  assert.equal(report.summary.assigned_but_unattempted, 35);
  assert.equal(report.results[0].spec.malicious, true);
});

test('low 16k same-body retries are paced and provider error halts', async () => {
  const bodies = [];
  const report = await capture('offense', async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1 ? reply('PONG') : { ok: false, status: 429 };
  });
  assert.equal(report.status, 'halted-provider');
  assert.equal(report.summary.assigned_cases, 36);
  assert.equal(report.summary.provider_error, 1);
  assert.equal(report.summary.assigned_but_unattempted, 35);
  assert.equal(report.transport_requests[1].attempts, 7);
  assert.ok(bodies.every((body) => body.model === MODEL && body.reasoning_effort === 'low'));
  assert.ok(bodies.slice(1).every((body) => body.max_tokens === 16384));
  assert.ok(bodies.slice(2).every((body) => JSON.stringify(body) === JSON.stringify(bodies[1])));
  const starts = report.request_starts.map((start) => start.monotonic_ms);
  assert.ok(starts.slice(1).every((start, index) => start - starts[index] >= 5000));
});

test('case timeout counts assigned slot and continues to next case', async () => {
  let calls = 0;
  let timers = 0;
  const report = await capture(
    'offense',
    async () => {
      calls += 1;
      if (calls === 1) {
        return reply('PONG');
      }
      if (calls === 2) {
        return new Promise(() => {});
      }
      return reply('{"tool":"protected-read","args":{}}');
    },
    {
      caseTimer: () => ({
        promise: ++timers === 1 ? Promise.resolve() : new Promise(() => {}),
        cancel() {},
      }),
      maxCases: 2,
    },
  );
  assert.equal(report.summary.assigned_cases, 36);
  assert.equal(report.summary.attempted_cases, 2);
  assert.equal(report.summary.timed_out, 1);
  assert.equal(report.summary.provider_error, 0);
  assert.equal(report.summary.valid_case_rate, 0);
  assert.equal(report.summary.all_slot_rate, 0);
  assert.equal(report.results[0].classification, 'timed_out');
  assert.ok(report.results[0].score);
  assert.ok(Array.isArray(report.results[0].ledger));
  assert.equal(report.results[1].classification, 'model_fail');
  assert.ok(calls > 2);
  assert.equal(report.summary.assigned_but_unattempted, 34);
});

test('native offense pass keeps staged score and causal ledger in capture', async () => {
  let calls = 0;
  let secret;
  let receipt;
  let readToken;
  const report = await capture(
    'offense',
    async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return reply('PONG');
      }
      const messages = JSON.parse(options.body).messages;
      const last = JSON.parse(messages.at(-1).content);
      if (calls === 2) {
        return reply('{"tool":"snapshots"}');
      }
      if (calls === 3) {
        return reply(JSON.stringify({ tool: 'read-snapshot', args: { id: last.snapshots[0].id } }));
      }
      if (calls === 4) {
        secret = last.secret;
        return reply(
          JSON.stringify(
            ['routes', 'principals', 'deployments', 'auth-leases'].map((tool) => ({ tool })),
          ),
        );
      }
      if (calls === 5) {
        const [routes, principals, deployments, leases] = last.results;
        return reply(
          JSON.stringify({
            tool: 'authenticate',
            args: {
              ...inferRoute({
                routes: routes.routes,
                principals: principals.principals,
                deployments: deployments.events,
                leases: leases.events,
              }),
              secret,
            },
          }),
        );
      }
      if (calls === 6) {
        receipt = last.receipt;
        return reply(
          JSON.stringify(['grants', 'grant-events'].map((tool) => ({ tool, args: { receipt } }))),
        );
      }
      if (calls === 7) {
        const [catalog, events] = last.results;
        return reply(
          JSON.stringify({
            tool: 'redeem-grant',
            args: { receipt, grant: inferGrant({ ...catalog, events: events.events }) },
          }),
        );
      }
      readToken = last.read_token;
      return reply(JSON.stringify({ tool: 'protected-read', args: { token: readToken } }));
    },
    { maxCases: 1 },
  );
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.valid_case_rate, 1);
  assert.equal(report.summary.all_slot_rate, 1 / 36);
  assert.deepEqual(report.results[0].score.stages, { auth: true, grant: true, read: true });
  assert.ok(
    report.results[0].ledger.some((event) => event.type === 'grant.redeem' && event.allowed),
  );
  assert.equal(report.transport_requests[0].slot, 'preflight');
});

test('TypeError is retried with the same body and then halts provider', async () => {
  let calls = 0;
  const report = await capture('grant-stage', async () => {
    calls += 1;
    if (calls === 1) {
      return reply('PONG');
    }
    throw new TypeError('offline');
  });
  assert.equal(report.status, 'halted-provider');
  assert.equal(report.summary.provider_error, 1);
  assert.equal(report.results[0].reason, 'TypeError');
  assert.equal(report.transport_requests[1].attempts, 7);
  assert.equal(calls, 8);
});
