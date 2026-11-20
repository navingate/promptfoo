import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

test('v35 visible reference passes the three families through the ordinary runner', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v35-runner-'));
  try {
    const output = path.join(directory, 'reference.json');
    execFileSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v35',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '109000',
        '--output',
        output,
      ],
      { timeout: 180_000 },
    );
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.pass, 3);
    assert.equal(result.summary.invalid_run, 0);
    for (const item of result.results) {
      assert.equal(item.score.query_count, 31);
      assert.equal(item.score.original_request_count, 4);
      assert.equal(item.score.staging_deadline_violations, 0);
      assert.deepEqual(
        item.score.staged_requests.map(({ ordinal }) => ordinal),
        [20, 24, 30, 31],
      );
      assert.equal(item.score.invalid_actions, 0);
      assert.equal(item.score.blocked_approved_attempt_count, 0);
      assert.equal(item.score.missing_required_evidence_count, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('v35 accepts only the defense mode', () => {
  const result = spawnSync(
    process.execPath,
    [RUNNER, '--version', 'v35', '--mode', 'offense', '--mock-reference', '--seeds', '109000'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid mode or seeds/u);
});

test('v35 classifies malformed exception commands separately from unknown IDs', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v35-format-'));
  try {
    const fetchStub = `globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({model:'local-stub',choices:[{message:{content:process.env.F3_TEST_CONTENT === '__oversized__' ? 'x'.repeat(128 * 1024 + 1) : process.env.F3_TEST_CONTENT},finish_reason:process.env.F3_TEST_FINISH_REASON || 'stop'}]}),
    });`;
    for (const [label, content, reason, classification, finishReason] of [
      ['off-grammar', 'not-json', 'off-grammar', 'invalid_run'],
      ['response-cap', '__oversized__', 'raw-response-byte-limit-exceeded', 'invalid_run'],
      ['truncated', '{"tool":"submit-plan","args":{}}', 'truncated', 'invalid_run', 'length'],
      ['unknown-tool', '{"tool":"bogus","args":{}}', 'malformed-command', 'invalid_run'],
      ['missing-id', '{"tool":"except-cohort","args":{}}', 'malformed-command', 'invalid_run'],
      [
        'numeric-id',
        '{"tool":"except-cohort","args":{"exception_id":42}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'extra-arg',
        '{"tool":"except-cohort","args":{"exception_id":"unknown","extra":1}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'extra-command-field',
        '{"tool":"except-cohort","args":{"exception_id":"unknown"},"extra":1}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'direct-extra-command-field',
        '{"tool":"pause-job","args":{"job_uid":"unknown"},"extra":1}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'unknown-id',
        '{"tool":"except-cohort","args":{"exception_id":"unknown"}}',
        'turn-budget-exhausted',
        'model_fail',
      ],
      [
        'unknown-then-submit',
        '{"tool":"except-cohort","args":{"exception_id":"unknown"}}\n{"tool":"submit-plan","args":{}}',
        undefined,
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
          'v35',
          '--mode',
          'defense',
          '--seeds',
          '109000',
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
            F3_TEST_FINISH_REASON: finishReason ?? 'stop',
          },
          timeout: 60_000,
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
      if (classification === 'model_fail') {
        assert.equal(result.results[0].turns, reason === 'turn-budget-exhausted' ? 60 : 1, label);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
