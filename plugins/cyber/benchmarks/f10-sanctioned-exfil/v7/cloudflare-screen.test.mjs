import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildInvocation,
  cloudflareChildEnv,
  DEFENSE_SEEDS,
  MODEL,
  OFFENSE_SEEDS,
  PILOT_SEED,
  parseArgs,
  verifyEndpointBinding,
} from './cloudflare-screen.mjs';

test('fixed offense seed CSV has exactly 36 integers and no empty final token', () => {
  const args = parseArgs(['--mode', 'offense', '--output', '/tmp/f10-v7-test-unique.json']);
  const invocation = buildInvocation(args);
  assert.equal(invocation.seeds.length, 36);
  assert.deepEqual(invocation.seeds, OFFENSE_SEEDS);
  assert.deepEqual(invocation.argv[2].split(',').map(Number), OFFENSE_SEEDS);
  assert.equal(invocation.argv[2].endsWith(','), false);
  assert.equal(invocation.argv.includes('80'), true);
});

test('defense and excluded pilot invoke frozen scripts with fixed seeds', () => {
  const defense = buildInvocation(
    parseArgs(['--mode', 'defense', '--output', '/tmp/f10-v7-defense-unique.json']),
  );
  assert.deepEqual(defense.seeds, DEFENSE_SEEDS);
  assert.equal(defense.argv[2], DEFENSE_SEEDS.join(','));
  const pilot = buildInvocation(
    parseArgs(['--mode', 'pilot-offense', '--output', '/tmp/f10-v7-pilot-unique.json']),
  );
  assert.deepEqual(pilot.seeds, [PILOT_SEED]);
  assert.equal(pilot.argv.includes('1'), true);
});

test('only the Cloudflare bearer token reaches the model subprocess', () => {
  const env = cloudflareChildEnv({
    CLOUDFLARE_OPENAI_BASE_URL: 'https://example.test/v1',
    CLOUDFLARE_API_KEY: 'cf-token',
    OPENAI_API_KEY: 'other-token',
    AWS_API_KEY: 'aws-token',
    CYBER_API_KEY: 'old-token',
    CYBER_MODEL: 'old-model',
  });
  assert.equal(env.CYBER_API_KEY, 'cf-token');
  assert.equal(env.CLOUDFLARE_API_KEY, undefined);
  assert.equal(env.CYBER_MODEL, MODEL);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.AWS_API_KEY, undefined);
  assert.equal(env.CYBER_SUT_ENDPOINT, 'https://example.test/v1');
  assert.throws(
    () => cloudflareChildEnv({ CLOUDFLARE_OPENAI_BASE_URL: 'https://example.test/v1' }),
    /CLOUDFLARE_API_KEY/,
  );
});

test('live calls reject a changed endpoint before any child process', () => {
  assert.throws(
    () => verifyEndpointBinding({ CLOUDFLARE_OPENAI_BASE_URL: 'https://example.test/v1' }),
    /changed after preregistration/,
  );
  assert.doesNotThrow(() => verifyEndpointBinding({}, true));
});

test('raw outputs cannot be stored in repo or overwrite prior captures', () => {
  assert.throws(
    () =>
      parseArgs([
        '--mode',
        'offense',
        '--output',
        new URL('./capture.json', import.meta.url).pathname,
      ]),
    /outside/,
  );
  assert.throws(() => parseArgs(['--mode', 'other']), /mode must/);
  assert.throws(() => parseArgs(['--mode', 'offense', '--resume']), /only defense/);
});

test('defense resume preserves a prior checkpoint and passes through the native flag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v7-resume-'));
  try {
    const output = path.join(dir, 'capture.json');
    fs.writeFileSync(output, '{}', { mode: 0o600 });
    assert.throws(() => parseArgs(['--mode', 'defense', '--output', output]), /already exists/);
    const args = parseArgs(['--mode', 'defense', '--output', output, '--resume']);
    assert.equal(buildInvocation(args).argv.at(-1), '--resume');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
