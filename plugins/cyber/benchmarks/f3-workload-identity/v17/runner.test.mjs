import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RULE_GUIDE } from './rule_guide.mjs';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v17 guide describes the two visible approval lanes without answer keys', () => {
  assert.match(RULE_GUIDE, /version \(integer 3\)/u);
  assert.match(RULE_GUIDE, /change authorization and data-owner authorization/iu);
  assert.match(RULE_GUIDE, /approval_publications/u);
  assert.doesNotMatch(RULE_GUIDE, /Inspect the labeled training world/iu);
  assert.doesNotMatch(RULE_GUIDE, /approval_cause|authorized\s*:|case [1-6]/iu);
});

test('v17 mock reference runs through the normal defense runner', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v17-runner-'));
  try {
    const output = path.join(directory, 'result.json');
    const run = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v17',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '35001',
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
    assert.equal(result.results[0].score.exact_batch, true);
    assert.equal(result.results[0].score.source_decisions, 6);
    assert.equal(result.results[0].score.job_decisions, 12);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
