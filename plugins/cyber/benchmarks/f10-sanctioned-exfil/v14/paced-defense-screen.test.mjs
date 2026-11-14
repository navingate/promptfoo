import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  parseArgs,
  planDefense,
  summarizeDefenseResults,
  validateLiveEnv,
} from './paced-defense-screen.mjs';

test('defense-only screen fixes the 12 scored seeds and Cloudflare request budget', () => {
  const plan = planDefense();
  assert.deepEqual(
    plan.seeds,
    Array.from({ length: 12 }, (_, i) => 14001 + i),
  );
  assert.equal(plan.task, 'defense');
  assert.equal(plan.reasoningEffort, 'low');
  assert.throws(() => parseArgs(['--mode', 'offense']), /unknown option/u);
});

test('mock screen accepts provisional evidence and safe output path', () => {
  const args = parseArgs([
    '--mock-reference',
    '--evidence-dir',
    os.tmpdir(),
    '--output',
    path.join(os.tmpdir(), `f10-v14-screen-${process.pid}.json`),
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
    { classification: 'invalid_run', reason: 'served-model-mismatch' },
    { classification: 'provider_error', reason: 'timeout' },
  ];
  const summary = summarizeDefenseResults(results, { mock: true, plan: { seeds: Array(5) } }, {});
  assert.equal(summary.invalid_slots, 3);
  assert.equal(summary.off_grammar, 1);
  assert.equal(summary.invalid_runs, 1);
  assert.equal(summary.provider_errors, 1);
  assert.equal(summary.valid_batches, 2);
  assert.equal(summary.parsed_batches, 2);
  assert.equal(summary.exact_batches, 1);
  assert.equal(summary.true_positives, 3);
  assert.equal(summary.false_positives, 2);
  assert.equal(summary.false_negatives, 3);
  assert.equal(summary.precision, 0.6);
  assert.equal(summary.recall, 0.5);
  assert.equal(summary.confusion['cumulative-exfil']['cumulative-exfil'], 4);
  assert.equal(summary.pair_exact, 3);
  assert.equal(summary.pair_total, 10);
});
