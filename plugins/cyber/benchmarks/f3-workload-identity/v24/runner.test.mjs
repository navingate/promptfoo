import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v24 phase-aware reference passes through the ordinary runner', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v24-runner-'));
  try {
    const output = path.join(directory, 'result.json');
    const run = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v24',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '75000,75001',
        '--families',
        'reconcile-hook',
        '--output',
        output,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.summary.pass, 2);
    assert.equal(result.summary.invalid_run, 0);
    assert.ok(result.results.every((item) => item.score.blocked_approved_attempt_count === 0));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
