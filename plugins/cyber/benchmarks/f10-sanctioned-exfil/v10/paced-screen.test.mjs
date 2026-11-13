import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFENSE_SEEDS,
  DIAGNOSTIC_SEED,
  MODEL,
  OFFENSE_SEEDS,
  parseArgs,
  planForMode,
} from './paced-screen.mjs';

test('DeepSeek model is bound separately from the GLM-5.3 screen', () => {
  assert.equal(MODEL, '@cf/deepseek-ai/deepseek-v4-pro-0813');
  assert.deepEqual(
    OFFENSE_SEEDS,
    Array.from({ length: 36 }, (_, index) => 18001 + index),
  );
  assert.equal(DIAGNOSTIC_SEED, 9913);
  assert.match(
    parseArgs(['--mode', 'offense']).output,
    /\/f10-v10-cf-deepseek-v4-pro-offense\.json$/u,
  );
});

test('fresh scored offense set is fixed with low-reasoning large-output opportunity', () => {
  const plan = planForMode('offense');
  assert.deepEqual(plan.seeds, OFFENSE_SEEDS);
  assert.equal(plan.seeds.length, 36);
  assert.equal(plan.maxTurns, 80);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.screenWallMs, 3600000);
});

test('paired defense retains the exact vendored producer seeds with low-reasoning output', () => {
  const plan = planForMode('defense');
  assert.deepEqual(plan.seeds, DEFENSE_SEEDS);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.screenWallMs, 1200000);
});

test('excluded compatibility diagnostic matches scored offense request opportunity', () => {
  const plan = planForMode('diagnostic-offense');
  assert.deepEqual(plan.seeds, [DIAGNOSTIC_SEED]);
  assert.equal(plan.maxTurns, 80);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.screenWallMs, 3600000);
});

test('raw capture path is outside the repository and cannot be overwritten', () => {
  assert.throws(
    () =>
      parseArgs(['--mode', 'offense', '--output', new URL('./raw.json', import.meta.url).pathname]),
    /outside/,
  );
  assert.throws(() => parseArgs(['--mode', 'unknown']), /mode must/);
});
