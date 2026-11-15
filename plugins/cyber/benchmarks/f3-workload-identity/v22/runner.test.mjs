import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v22 query reference passes through ordinary CLI and native score', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v22-runner-'));
  try {
    const output = path.join(directory, 'result.json');
    const run = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v22',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '63000,63001',
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
    assert.ok(result.results.every((item) => item.score.query_count <= 32));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
