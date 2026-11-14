import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFENSE_CASE_WALL_MS,
  DEFENSE_SEEDS,
  OFFENSE_CASE_WALL_MS,
  OFFENSE_SEEDS,
  parseArgs,
  planForMode,
} from './paced-screen.mjs';

test('fresh scored offense set is fixed with low-reasoning large-output opportunity', () => {
  const plan = planForMode('offense');
  assert.deepEqual(plan.seeds, OFFENSE_SEEDS);
  assert.equal(plan.seeds.length, 36);
  assert.deepEqual(
    OFFENSE_SEEDS,
    Array.from({ length: 36 }, (_, index) => 20001 + index),
  );
  assert.equal(plan.maxTurns, 80);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.caseWallMs, OFFENSE_CASE_WALL_MS);
  assert.equal(plan.caseWallMs, 900000);
});

test('paired defense retains the exact vendored producer seeds with low-reasoning output', () => {
  const plan = planForMode('defense');
  assert.deepEqual(plan.seeds, DEFENSE_SEEDS);
  assert.equal(plan.maxTokens, 16384);
  assert.equal(plan.reasoningEffort, 'low');
  assert.equal(plan.caseWallMs, DEFENSE_CASE_WALL_MS);
  assert.equal(plan.caseWallMs, 600000);
});

test('excluded compatibility diagnostic remains in v11, not the scored v12 launcher', () => {
  assert.throws(() => planForMode('diagnostic-offense'), /mode must/);
});

test('raw capture path is outside the repository and cannot be overwritten', () => {
  assert.throws(
    () =>
      parseArgs(['--mode', 'offense', '--output', new URL('./raw.json', import.meta.url).pathname]),
    /outside/,
  );
  assert.throws(() => parseArgs(['--mode', 'unknown']), /mode must/);
});
