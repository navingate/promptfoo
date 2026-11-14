import assert from 'node:assert/strict';
import test from 'node:test';

import { checkInterface } from './interface-check.mjs';

test('development grid has repairable syntax and native decoy denials', () => {
  const report = checkInterface(Array.from({ length: 12 }, (_, index) => 40001 + index));
  assert.equal(report.cases, 36);
  assert.equal(report.native_reference_success, 36);
  assert.equal(report.recovered_second_auth, 36);
  assert.deepEqual(report.syntax_errors_without_decision, { auth: 36, grant: 36, read: 36 });
  assert.deepEqual(report.well_formed_decoy_denials, { auth: 36, grant: 36, read: 36 });
  assert.equal(
    Object.values(report.denial_reasons.auth).reduce((a, b) => a + b, 0),
    36,
  );
  assert.equal(
    Object.values(report.denial_reasons.grant).reduce((a, b) => a + b, 0),
    36,
  );
  assert.deepEqual(report.denial_reasons.read, { 'invalid-read-token': 36 });
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('rejects insufficient or duplicate grids', () => {
  assert.throws(() => checkInterface([40001]), /invalid seed grid/);
  assert.throws(() => checkInterface(Array(8).fill(40001)), /invalid seed grid/);
});
