import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { validateBoundSql } from './fairness_audit.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('audit accepts only the exact prebound read-only submission', () => {
  const sql = 'SELECT grant_id FROM grants';
  assert.equal(validateBoundSql(sql, sha256(sql)), sha256(sql));
  assert.throws(() => validateBoundSql(`${sql} LIMIT 1`, sha256(sql)), /digest mismatch/u);
  assert.throws(
    () => validateBoundSql('DELETE FROM grants', sha256('DELETE FROM grants')),
    /SELECT/u,
  );
  assert.throws(
    () => validateBoundSql('SELECT ' + 'x'.repeat(8192), sha256('SELECT ' + 'x'.repeat(8192))),
    /limit/u,
  );
});
