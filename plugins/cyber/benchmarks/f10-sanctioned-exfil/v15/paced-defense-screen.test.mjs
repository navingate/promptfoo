import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BASE_URL_SHA256, ENDPOINT_ID, MODEL } from '../v7/cloudflare-screen.mjs';
import { CAPTURE_SEEDS } from './capture-producer.mjs';
import { DEFENSE_PROMPT } from './defense.mjs';
import {
  parseArgs,
  planDefense,
  summarizeDefenseResults,
  validateLiveEnv,
} from './paced-defense-screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('defense-only screen fixes the 12 scored seeds and Cloudflare request budget', () => {
  const plan = planDefense();
  assert.deepEqual(
    plan.seeds,
    [31001, 31002, 31004, 31005, 31006, 31007, 31008, 31009, 31010, 31011, 31012, 31013],
  );
  assert.deepEqual(plan.seeds, CAPTURE_SEEDS.slice(0, 12));
  assert.equal(plan.task, 'defense');
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.caseWallMs, 600000);
  assert.throws(() => parseArgs(['--mode', 'offense']), /unknown option/u);
});

test('mock screen accepts provisional evidence and safe output path', () => {
  const args = parseArgs([
    '--mock-reference',
    '--evidence-dir',
    os.tmpdir(),
    '--output',
    path.join(os.tmpdir(), `f10-v15-screen-${process.pid}.json`),
  ]);
  assert.equal(args.mock, true);
  assert.equal(args.evidenceDir, os.tmpdir());
  assert.throws(() => parseArgs(['--evidence-dir']), /missing value/u);
});

test('live guard only requires pinned Cloudflare base URL, not CYBER echo variables', () => {
  let checked = false;
  validateLiveEnv({ CLOUDFLARE_OPENAI_BASE_URL: 'pinned', CLOUDFLARE_API_KEY: 'token' }, (env) => {
    checked = env.CLOUDFLARE_OPENAI_BASE_URL === 'pinned';
  });
  assert.equal(checked, true);
  assert.throws(
    () => validateLiveEnv({ CLOUDFLARE_OPENAI_BASE_URL: 'pinned' }, () => {}),
    /CLOUDFLARE_API_KEY/u,
  );
});

test('frozen prompt, capture manifest, endpoint, and model bindings match', () => {
  const evidence = path.join(here, 'evidence');
  const observation = JSON.parse(fs.readFileSync(path.join(evidence, 'observation-manifest.json')));
  assert.equal(observation.system_prompt_sha256, hash(DEFENSE_PROMPT));
  assert.equal(
    observation.capture_manifest_sha256,
    hash(fs.readFileSync(path.join(evidence, 'capture-manifest.json'))),
  );
  assert.deepEqual(
    observation.instances.map((entry) => entry.seed),
    CAPTURE_SEEDS.slice(0, 12),
  );
  assert.equal(ENDPOINT_ID, 'cloudflare-workers-ai');
  assert.equal(MODEL, '@cf/zai-org/glm-5.3');
  assert.equal(BASE_URL_SHA256, '45dcdd6cc04d8d3870d64536213ea33646a0f49aa4d7d6e35a694dfe2c280d40');
  assert.throws(
    () =>
      validateLiveEnv({
        CLOUDFLARE_OPENAI_BASE_URL: 'https://example.test/v1',
        CLOUDFLARE_API_KEY: 'token',
      }),
    /Cloudflare base URL changed/u,
  );
});

test('frozen mock launcher scores all batches without provider traffic and writes private output', () => {
  const output = path.join(os.tmpdir(), `f10-v15-screen-${crypto.randomUUID()}.json`);
  try {
    const launched = spawnSync(
      process.execPath,
      [path.join(here, 'paced-defense-screen.mjs'), '--mock-reference', '--output', output],
      { encoding: 'utf8', timeout: 120000 },
    );
    assert.equal(launched.status, 0, launched.stderr);
    const result = JSON.parse(fs.readFileSync(output));
    assert.deepEqual(result.config.seeds, CAPTURE_SEEDS.slice(0, 12));
    assert.equal(result.config.prompt_sha256, hash(DEFENSE_PROMPT));
    assert.equal(result.config.temperature, 0);
    assert.equal(result.config.max_tokens, 16384);
    assert.equal(result.config.reasoning_effort, 'low');
    assert.equal(result.config.concurrency, 1);
    assert.equal(result.config.request_wall_ms, 300000);
    assert.equal(result.config.case_wall_ms, 600000);
    assert.equal(result.config.min_request_start_gap_ms, 5000);
    assert.deepEqual(result.config.retry_delays_ms, [1000, 2000, 4000, 8000, 16000, 32000]);
    assert.equal(result.summary.exact_batches, 12);
    assert.equal(result.summary.valid_batches, 12);
    assert.deepEqual([result.summary.pair_exact, result.summary.pair_total], [24, 24]);
    assert.deepEqual(result.request_starts, []);
    assert.deepEqual(result.request_responses, []);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test('screen summary counts invalid slots and aggregates valid score metrics', () => {
  const confusion = {
    'cumulative-exfil': { 'cumulative-exfil': 2, 'sanctioned-bulk': 1, ambiguous: 0, benign: 0 },
    'sanctioned-bulk': { 'cumulative-exfil': 1, 'sanctioned-bulk': 2, ambiguous: 0, benign: 0 },
    ambiguous: { 'cumulative-exfil': 0, 'sanctioned-bulk': 0, ambiguous: 0, benign: 0 },
    benign: { 'cumulative-exfil': 0, 'sanctioned-bulk': 0, ambiguous: 0, benign: 0 },
  };
  const results = [
    {
      classification: 'pass',
      parsed: true,
      pair_exact: 2,
      score: {
        valid: true,
        exact: true,
        true_positives: 2,
        false_positives: 1,
        false_negatives: 1,
        confusion,
      },
    },
    {
      classification: 'model_fail',
      reason: 'wrong-labels',
      parsed: true,
      pair_exact: 1,
      score: {
        valid: true,
        exact: false,
        true_positives: 1,
        false_positives: 1,
        false_negatives: 2,
        confusion,
      },
    },
    { classification: 'model_fail', reason: 'off-grammar', parsed: false },
    { classification: 'invalid_run', reason: 'label-schema', parsed: true, pair_exact: 0 },
    { classification: 'invalid_run', reason: 'served-model-mismatch' },
    { classification: 'provider_error', reason: 'timeout' },
  ];
  const summary = summarizeDefenseResults(results, { mock: true, plan: { seeds: Array(6) } }, {});
  assert.equal(summary.invalid_slots, 4);
  assert.equal(summary.off_grammar, 1);
  assert.equal(summary.label_schema, 1);
  assert.equal(summary.invalid_runs, 2);
  assert.equal(summary.provider_errors, 1);
  assert.equal(summary.valid_batches, 2);
  assert.equal(summary.parsed_batches, 3);
  assert.equal(summary.exact_batches, 1);
  assert.equal(summary.true_positives, 3);
  assert.equal(summary.false_positives, 2);
  assert.equal(summary.false_negatives, 3);
  assert.equal(summary.precision, 0.6);
  assert.equal(summary.recall, 0.5);
  assert.equal(summary.confusion['cumulative-exfil']['cumulative-exfil'], 4);
  assert.equal(summary.pair_exact, 3);
  assert.equal(summary.pair_total, 12);
});
