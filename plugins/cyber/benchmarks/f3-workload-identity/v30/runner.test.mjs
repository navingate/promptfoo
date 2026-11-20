import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v30 reference passes through the ordinary runner', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v30-runner-'));
  try {
    const output = path.join(directory, 'reference.json');
    execFileSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v30',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '96000',
        '--output',
        output,
      ],
      { timeout: 30_000 },
    );
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.summary.pass, 3);
    assert.equal(result.summary.invalid_run, 0);
    assert.ok(result.results.every((item) => item.score.query_count === 31));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('v30 separates malformed syntax from out-of-scope containment controls', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v30-format-'));
  try {
    const fetchStub = `globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({model:'local-stub',choices:[{message:{content:process.env.F3_TEST_CONTENT},finish_reason:'stop'}]}),
    });`;
    for (const [label, content, reason, classification] of [
      ['off-grammar', 'not-json', 'off-grammar', 'invalid_run'],
      [
        'invalid-args',
        '{"tool":"submit-plan","args":{"extra":1}}',
        'malformed-command',
        'invalid_run',
      ],
      ['unknown-tool', '{"tool":"bogus","args":{}}', 'malformed-command', 'invalid_run'],
      [
        'invalid-control-args',
        '{"tool":"pause-job","args":{"job_uid":1}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'out-of-scope',
        '{"tool":"pause-job","args":{"job_uid":"job-not-in-index"}}',
        'turn-budget-exhausted',
        'model_fail',
      ],
    ]) {
      const output = path.join(directory, `${label}.json`);
      execFileSync(
        process.execPath,
        [
          '--import',
          `data:text/javascript,${encodeURIComponent(fetchStub)}`,
          RUNNER,
          '--version',
          'v30',
          '--mode',
          'defense',
          '--seeds',
          '96000',
          '--families',
          'reconcile-hook',
          '--output',
          output,
        ],
        {
          env: {
            ...process.env,
            CYBER_SUT_ENDPOINT: 'http://not-used.invalid',
            CYBER_ENDPOINT_ID: 'local-test',
            CYBER_MODEL: 'local-stub',
            CYBER_API_KEY: 'test',
            F3_TEST_CONTENT: content,
          },
          timeout: 30_000,
        },
      );
      const result = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(result.summary[classification], 1, label);
      assert.equal(
        result.summary[classification === 'invalid_run' ? 'model_fail' : 'invalid_run'],
        0,
        label,
      );
      assert.equal(result.results[0].reason, reason, label);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
