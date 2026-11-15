import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v21 paired response cases run through the ordinary CLI and native score', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v21-runner-'));
  try {
    const output = path.join(directory, 'result.json');
    const run = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v21',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '55000,55001',
        '--families',
        'reconcile-hook',
        '--output',
        output,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((item) => item.classification === 'pass'));
    assert.ok(result.results.every((item) => item.score.success));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
