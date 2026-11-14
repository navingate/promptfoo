import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { modelMessages } from './prompt.mjs';
import { MODEL_ID, requestSql, runScreen, scoreAlerts, scoreProjectedControls } from './screen.mjs';

const response = (content, model = MODEL_ID, finishReason = 'stop') => ({
  ok: true,
  json: async () => ({ model, choices: [{ finish_reason: finishReason, message: { content } }] }),
});
const request = async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(body.model, MODEL_ID);
  assert.equal(body.max_tokens, 16384);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0);
  return response('SELECT grant_id FROM grants WHERE 0');
};
const testCorpus = () => ({
  batches: fs
    .readFileSync(new URL('./capture/native-v9.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse),
  keys: fs
    .readFileSync(new URL('./evaluator/labels-v9.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse),
});

test('prompt contains only schema and independent unlabeled development rows', () => {
  const prompt = JSON.stringify(modelMessages());
  const heldout = JSON.parse(
    fs.readFileSync(new URL('./capture/native-v9.jsonl', import.meta.url), 'utf8').split('\n')[0],
  );
  assert.equal(prompt.includes(heldout.captures[0].capture_id), false);
  assert.equal(prompt.includes('malicious-missed-by-query'), false);
  assert.equal(prompt.includes('count_schedule'), false);
  assert.equal(prompt.includes('grant_id'), true);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v9-screen-test-'));
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
        assert.equal(batches.length, executions === 1 ? 36 : 14);
        const frozen = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
        assert.equal(frozen.submission.sql, sql);
        assert.equal(frozen.score, null);
        return batches.map(() => []);
      },
    });
    assert.equal(executions, 2);
    assert.equal(result.score.classification, 'model_fail');
    assert.equal(result.score.projected_controls.total, 14);
    assert.equal(fs.statSync(path.join(dir, 'result.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corpus readiness fails before model request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v9-readiness-test-'));
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

test('live invocation stays disabled until Bedrock target is bound', async () => {
  await assert.rejects(
    runScreen({ output: path.join(os.tmpdir(), 'unused-v9.json') }),
    /Bedrock GLM-5 binding/,
  );
});
