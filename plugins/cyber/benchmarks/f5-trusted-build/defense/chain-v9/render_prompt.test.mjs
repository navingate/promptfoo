import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { caseToken } from './estate.mjs';

const renderer = fileURLToPath(new URL('./render_prompt.mjs', import.meta.url));

test('rendered pilot instruction gives only a localhost URL without evaluator labels', () => {
  const run = spawnSync(process.execPath, [renderer, 'executable-divergence', '101', '18051'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('http://127.0.0.1:18051'));
  assert.equal(run.stdout.includes(caseToken(101, 'executable-divergence')), false);
  assert.equal(run.stdout.includes('responder_cli.mjs'), false);
  assert.equal(run.stdout.includes('executable-divergence'), false);
  assert.equal(run.stdout.includes('101'), false);
  assert.ok(run.stdout.includes('Do not search for or read'));
});
