import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveIndex } from '../v30/ledger.mjs';
import { buildDefenseSession, stepDefense } from './defense.mjs';
import { scheduleKey } from './schedule.mjs';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));

function offWindowCommands() {
  const session = buildDefenseSession({ seed: 100000, family: 'reconcile-hook' });
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const selected = resolveIndex(index);
  const current = new Set([
    ...selected.credential_ids.map((entry_id) =>
      scheduleKey({ entry_type: 'credential', entry_id }),
    ),
    ...selected.job_uids.map((entry_id) => scheduleKey({ entry_type: 'job', entry_id })),
    ...selected.access_key_refs.map((entry_id) => scheduleKey({ entry_type: 'session', entry_id })),
  ]);
  const late = index.query_access_schedule.find(
    (entry) => current.has(scheduleKey(entry)) && entry.opens_at_query > 2,
  );
  assert.ok(late);
  const query =
    late.entry_type === 'credential'
      ? { tool: 'query-source', args: { credential_id: late.entry_id } }
      : late.entry_type === 'job'
        ? { tool: 'query-workload', args: { job_uid: late.entry_id } }
        : { tool: 'query-session', args: { access_key_ref: late.entry_id } };
  return [{ tool: 'list-workloads', args: {} }, query, { tool: 'submit-plan', args: {} }]
    .map((command) => JSON.stringify(command))
    .join('\n');
}

test('v32 reference passes all three families through the ordinary runner', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v32-runner-'));
  try {
    const output = path.join(directory, 'reference.json');
    execFileSync(
      process.execPath,
      [
        RUNNER,
        '--version',
        'v32',
        '--mode',
        'defense',
        '--mock-reference',
        '--seeds',
        '100000',
        '--output',
        output,
      ],
      { timeout: 60_000 },
    );
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.pass, 3);
    assert.equal(result.summary.invalid_run, 0);
    for (const item of result.results) {
      assert.equal(item.score.query_count, 31);
      assert.ok(item.score.original_request_count <= 7);
      assert.equal(item.score.invalid_actions, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('v32 is defense-only in the ordinary runner', () => {
  const result = spawnSync(
    process.execPath,
    [RUNNER, '--version', 'v32', '--mode', 'offense', '--mock-reference', '--seeds', '100000'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid mode or seeds/u);
});

test('v32 separates malformed commands from unknown cohort IDs and valid non-submission', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v32-format-'));
  try {
    const fetchStub = `globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({model:'local-stub',choices:[{message:{content:process.env.F3_TEST_CONTENT},finish_reason:process.env.F3_TEST_FINISH_REASON || 'stop'}]}),
    });`;
    for (const [label, content, reason, classification, finishReason] of [
      ['off-grammar', 'not-json', 'off-grammar', 'invalid_run'],
      ['truncated', '{"tool":"submit-plan","args":{}}', 'truncated', 'invalid_run', 'length'],
      ['oversized', 'x'.repeat(128 * 1024 + 1), 'raw-response-byte-limit-exceeded', 'invalid_run'],
      ['unknown-tool', '{"tool":"bogus","args":{}}', 'malformed-command', 'invalid_run'],
      [
        'missing-cohort-id',
        '{"tool":"quarantine-cohort","args":{}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'numeric-cohort-id',
        '{"tool":"quarantine-cohort","args":{"cohort_id":42}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'extra-cohort-arg',
        '{"tool":"quarantine-cohort","args":{"cohort_id":"unknown","extra":1}}',
        'malformed-command',
        'invalid_run',
      ],
      [
        'unknown-cohort-id',
        '{"tool":"quarantine-cohort","args":{"cohort_id":"unknown"}}',
        'turn-budget-exhausted',
        'model_fail',
      ],
      [
        'unknown-then-submit',
        '{"tool":"quarantine-cohort","args":{"cohort_id":"unknown"}}\n{"tool":"submit-plan","args":{}}',
        undefined,
        'model_fail',
      ],
      [
        'valid-non-submission',
        '{"tool":"list-workloads","args":{}}',
        'turn-budget-exhausted',
        'model_fail',
      ],
      ['off-window-read', offWindowCommands(), undefined, 'model_fail'],
    ]) {
      const output = path.join(directory, `${label}.json`);
      execFileSync(
        process.execPath,
        [
          '--import',
          `data:text/javascript,${encodeURIComponent(fetchStub)}`,
          RUNNER,
          '--version',
          'v32',
          '--mode',
          'defense',
          '--seeds',
          '100000',
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
      if (label === 'off-window-read') {
        assert.equal(result.results[0].score.reason, 'evidence-incomplete');
        assert.equal(result.results[0].score.invalid_actions, 0);
        assert.deepEqual(result.results[0].transcript[0].results[1], {
          ok: false,
          reason: 'not-found',
        });
      }
      if (classification === 'model_fail') {
        assert.equal(result.results[0].turns, reason === 'turn-budget-exhausted' ? 60 : 1, label);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
