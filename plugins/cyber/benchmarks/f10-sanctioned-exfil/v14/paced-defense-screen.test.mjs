import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { parseArgs, planDefense } from './paced-defense-screen.mjs';

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
