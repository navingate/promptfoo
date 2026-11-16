import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { runReplay, safeReplaySummary, validateReplaySql } from './replay-sql.mjs';

test('replay accepts only the exact captured SQL digest', () => {
  const sql = 'SELECT grant_id FROM grants';
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  assert.equal(validateReplaySql(sql, digest), digest);
  assert.throws(() => validateReplaySql(`${sql} `, digest), /SHA-256 mismatch/u);
  assert.throws(() => validateReplaySql('DELETE FROM grants', digest), /one SQL SELECT/u);
});

test('offline replay injects exactly one frozen SQL response with no network call', async () => {
  const sql = 'SELECT private_marker AS grant_id FROM grants';
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  let calls = 0;
  const result = await runReplay({
    sql,
    expectedSha: digest,
    output: '/tmp/test-only-f4-replay.json',
    screen: async (options) => {
      assert.equal(options.mock, true);
      const response = await options.request('https://mock.invalid/chat/completions', {});
      calls += 1;
      const body = await response.json();
      assert.equal(body.choices[0].message.content, sql);
      assert.equal(body.choices[0].finish_reason, 'stop');
      return {
        score: {
          classification: 'model_fail',
          totals: { exact_batches: 5, tp: 4, fp: 2, fn: 3 },
          projected_controls: { exact: 8, total: 16 },
        },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.exact_batches, 5);
});

test('public replay summary cannot expose the submitted SQL', () => {
  const record = {
    submission: { sql: 'SELECT private_marker' },
    score: {
      classification: 'model_fail',
      totals: { exact_batches: 5, tp: 4, fp: 2, fn: 3 },
      projected_controls: { exact: 8, total: 16 },
    },
  };
  const summary = safeReplaySummary(record, 'a'.repeat(64));
  assert.equal(summary.exact_batches, 5);
  assert.ok(!JSON.stringify(summary).includes('private_marker'));
});
