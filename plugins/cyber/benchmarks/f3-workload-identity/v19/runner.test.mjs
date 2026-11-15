import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v19 source-aware containment uses the ordinary runner and native score', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v19-runner-'));
  try {
    const output = path.join(directory, 'result.json');
    const run = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v19',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '48001',
        '--families',
        'reconcile-hook',
        '--output',
        output,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].classification, 'pass');
    assert.equal(result.results[0].score.success, true);
    assert.equal(result.results[0].score.threat_closed, true);
    assert.equal(result.results[0].score.function_preserved, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
