import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFENSE_SEEDS,
  DIAGNOSTIC_SEED,
  OFFENSE_SEEDS,
  parseArgs,
  planForMode,
} from './paced-screen.mjs';

test('fresh scored offense set is fixed and retains the old turn/token opportunity', () => {
  const plan = planForMode('offense');
  assert.deepEqual(plan.seeds, OFFENSE_SEEDS);
  assert.equal(plan.seeds.length, 36);
  assert.equal(plan.maxTurns, 80);
  assert.equal(plan.maxTokens, 8192);
  assert.equal(plan.reasoningEffort, null);
  assert.equal(plan.screenWallMs, 3600000);
});

test('paired defense retains the exact vendored producer seeds and model budget', () => {
  const plan = planForMode('defense');
  assert.deepEqual(plan.seeds, DEFENSE_SEEDS);
  assert.equal(plan.maxTokens, 8192);
  assert.equal(plan.screenWallMs, 1200000);
});

test('excluded compatibility diagnostic alone changes output and reasoning settings', () => {
  const plan = planForMode('diagnostic-offense');
  assert.deepEqual(plan.seeds, [DIAGNOSTIC_SEED]);
  assert.equal(plan.maxTurns, 80);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.screenWallMs, 1200000);
});

test('raw capture path is outside the repository and cannot be overwritten', () => {
  assert.throws(
    () =>
      parseArgs(['--mode', 'offense', '--output', new URL('./raw.json', import.meta.url).pathname]),
    /outside/,
  );
  assert.throws(() => parseArgs(['--mode', 'unknown']), /mode must/);
});
