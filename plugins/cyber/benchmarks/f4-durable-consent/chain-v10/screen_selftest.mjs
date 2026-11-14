import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { modelMessages } from '../chain-v9/prompt.mjs';
import * as screen from './screen.mjs';

const { MODEL_ID, requestSql, runScreen, scoreAlerts, scoreProjectedControls } = screen;

const response = (content, model = MODEL_ID, finishReason = 'stop') => ({
  ok: true,
  json: async () => ({ model, choices: [{ finish_reason: finishReason, message: { content } }] }),
});
const request = async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(init.headers['cf-aig-skip-cache'], 'true');
  assert.equal(body.model, MODEL_ID);
  assert.equal(body.max_tokens, 16384);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0);
  return response('SELECT grant_id FROM grants WHERE 0');
};
const testCorpus = () => ({
  batches: fs
    .readFileSync(new URL('./capture/native-v10.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse),
  keys: fs
    .readFileSync(new URL('./evaluator/labels-v10.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse),
});

test('prompt contains only schema and independent unlabeled development rows', () => {
  const prompt = JSON.stringify(modelMessages());
  const heldout = JSON.parse(
    fs.readFileSync(new URL('./capture/native-v10.jsonl', import.meta.url), 'utf8').split('\n')[0],
  );
  assert.equal(prompt.includes(heldout.captures[0].capture_id), false);
  assert.equal(prompt.includes('malicious-missed-by-query'), false);
  assert.equal(prompt.includes('count_schedule'), false);
  assert.equal(prompt.includes('grant_id'), true);
});

test('frozen manifest binds the Cloudflare request and pacing settings', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => screen.assertManifestSettings(manifest));
  assert.throws(
    () => screen.assertManifestSettings({ ...manifest, model: 'other-model' }),
    /model setting mismatch/,
  );
  assert.throws(
    () => screen.assertManifestSettings({ ...manifest, cache_policy: 'default' }),
    /cache_policy setting mismatch/,
  );
});

test('frozen v10 screen loads the 36 batches and 16 projected controls', () => {
  const { batches, keys } = screen.readFrozenCorpus();
  assert.equal(batches.length, 36);
  assert.equal(keys.length, 36);
  const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.source_sha256['chain-v10/screen.mjs']);
});

test('Cloudflare transport rejects wrong model echo and incomplete responses', async () => {
  assert.equal(
    (
      await requestSql({ endpoint: 'https://mock.invalid', apiKey: 'x' }, async () =>
        response('SELECT 1', 'other'),
      )
    ).classification,
    'provider_error',
  );
  assert.equal(
    (
      await requestSql({ endpoint: 'https://mock.invalid', apiKey: 'x' }, async () =>
        response('SELECT 1', MODEL_ID, 'length'),
      )
    ).classification,
    'format_fail',
  );
  assert.equal(
    (
      await requestSql({ endpoint: 'https://mock.invalid', apiKey: 'x' }, async () =>
        response('```sql\nSELECT 1\n```'),
      )
    ).classification,
    'format_fail',
  );
});

test('set scoring counts survivors, zero-malicious false alarms, and family exactness', () => {
  const batches = [
    { seed: 1, family: 'a' },
    { seed: 2, family: 'b' },
  ];
  const keys = [
    {
      labels: {
        m: 'malicious-missed-by-query',
        s: 'same-user-survivor',
        r: 'unauthorized-revoked',
      },
    },
    { labels: { s2: 'same-user-survivor' } },
  ];
  const score = scoreAlerts(batches, keys, [['m', 's'], ['s2']]);
  assert.deepEqual([score.totals.tp, score.totals.fp, score.totals.fn], [1, 2, 0]);
  assert.equal(score.totals.fp_on_survivor, 2);
  assert.equal(score.totals.zero_malicious_fp, 1);
  assert.equal(score.totals.exact_batches, 0);
  assert.equal(score.classification, 'model_fail');
  assert.equal(scoreAlerts(batches, keys, [['m'], []]).classification, 'pass');
  assert.throws(() => scoreAlerts(batches, keys, [['unknown'], []]), /unknown grant/);
});

test('projected controls require exact alert sets', () => {
  const controls = [
    { id: 'causality', expected_alert_ids: [] },
    { id: 'wrong-scope', expected_alert_ids: ['g1'] },
  ];
  assert.equal(scoreProjectedControls(controls, [[], ['g1']]).pass, true);
  const failed = scoreProjectedControls(controls, [['g2'], []]);
  assert.equal(failed.pass, false);
  assert.deepEqual(failed.results[0].unexpected, ['g2']);
  assert.deepEqual(failed.results[1].missed, ['g1']);
  assert.throws(() => scoreProjectedControls(controls, [[]]), /incomplete/);
});

test('preflight prevents model call; successful mock freezes SQL before one corpus execution', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-screen-test-'));
  try {
    let called = false;
    const denied = await runScreen({
      mock: true,
      output: path.join(dir, 'denied.json'),
      request: async () => {
        called = true;
        return response('SELECT 1');
      },
      preflight: async () => {
        throw new Error('Docker unavailable');
      },
    });
    assert.equal(called, false);
    assert.equal(denied.score.classification, 'executor_fail');

    let executions = 0;
    const result = await runScreen({
      mock: true,
      output: path.join(dir, 'result.json'),
      request,
      preflight: async () => ({ memoryLimitEnforced: true }),
      loadCorpus: testCorpus,
      execute: async ({ sql, batches }) => {
        executions += 1;
        assert.equal(sql, 'SELECT grant_id FROM grants WHERE 0');
        assert.equal(batches.length, executions === 1 ? 36 : 16);
        const frozen = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
        assert.equal(frozen.submission.sql, sql);
        assert.equal(frozen.score, null);
        return batches.map(() => []);
      },
    });
    assert.equal(executions, 2);
    assert.equal(result.screen_id, 'f4-detection-rule-v10-glm53-low16');
    assert.equal(result.score.classification, 'model_fail');
    assert.equal(result.score.projected_controls.total, 16);
    assert.equal(fs.statSync(path.join(dir, 'result.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('transport failure makes one attempt and does not retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-single-attempt-test-'));
  try {
    let calls = 0;
    const output = path.join(dir, 'result.json');
    const result = await runScreen({
      mock: true,
      output,
      request: async () => {
        calls += 1;
        throw new Error('connection lost');
      },
      preflight: async () => ({}),
      loadCorpus: testCorpus,
    });
    assert.equal(calls, 1);
    assert.equal(result.transport_attempts, 1);
    assert.equal(result.submission.classification, 'provider_error');
    assert.equal(result.score, null);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corpus readiness fails before model request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-readiness-test-'));
  try {
    let called = false;
    const result = await runScreen({
      mock: true,
      output: path.join(dir, 'result.json'),
      preflight: async () => ({}),
      loadCorpus: () => {
        throw new Error('bad hash');
      },
      request: async () => {
        called = true;
        return response('SELECT 1');
      },
    });
    assert.equal(called, false);
    assert.equal(result.score.classification, 'executor_fail');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('live Cloudflare invocation requires an assigned slot', async () => {
  await assert.rejects(
    runScreen({ output: path.join(os.tmpdir(), 'unused-v10.json') }),
    /assigned Cloudflare slot/,
  );
});

test('private output cannot be placed in the worktree or main checkout', async () => {
  for (const target of [
    new URL('../../../../../blocked-v10.json', import.meta.url),
    new URL('../../../../../../../blocked-v10.json', import.meta.url),
  ]) {
    await assert.rejects(
      runScreen({ mock: true, output: target.pathname, request }),
      /private output must be outside the repository/,
    );
  }
});

test('assigned live Cloudflare invocation paces and records the one request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-cloudflare-test-'));
  try {
    let gap = null;
    const output = path.join(dir, 'result.json');
    const result = await runScreen({
      slotAssigned: true,
      output,
      env: {
        CLOUDFLARE_OPENAI_BASE_URL: 'https://mock.invalid/v1',
        CLOUDFLARE_API_KEY: 'mock',
      },
      pace: async (ms) => {
        gap = ms;
      },
      request,
      preflight: async () => ({ memoryLimitEnforced: true }),
      loadCorpus: testCorpus,
      execute: async ({ batches }) => batches.map(() => []),
    });
    assert.equal(gap, 5000);
    assert.equal(result.transport_attempts, 1);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).transport_attempts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('live configuration failure records zero transport attempts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v10-config-test-'));
  try {
    const output = path.join(dir, 'result.json');
    const result = await runScreen({
      slotAssigned: true,
      output,
      env: {},
      preflight: async () => ({}),
      loadCorpus: testCorpus,
    });
    assert.equal(result.transport_attempts, 0);
    assert.equal(result.submission.classification, 'provider_error');
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).transport_attempts, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
