import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildResponseSession, scoreResponse, stepResponse } from './response.mjs';

const SPECS = FAMILIES.flatMap((family) =>
  Array.from({ length: 12 }, (_, offset) => ({ seed: 112000 + offset, family })),
);

function run(spec, tools) {
  const session = buildResponseSession(spec);
  const receipts = [];
  for (const tool of [...tools, 'submit-plan']) {
    const result = stepResponse(session, { tool, args: {} });
    assert.equal(result.ok, true, `${tool}: ${result.reason}`);
    receipts.push(result.receipt);
  }
  return { initial: session.initial, receipts, score: scoreResponse(session) };
}

test('ordinary hold, drain, verify, retire succeeds for drained and pending twins', () => {
  for (const spec of SPECS) {
    const result = run(spec, [
      'hold-issuance',
      'drain-admitted',
      'verify-replacement-read',
      'retire-old-role',
    ]);
    assert.equal(result.score.success, true, JSON.stringify({ spec, score: result.score }));
    assert.equal(result.score.unauthorized_completed, 0);
    assert.equal(result.score.approved_old_read_completed, true);
    assert.equal(result.score.replacement_read_completed, true);
    assert.equal(result.score.recoverable_function, true);
    assert.ok(result.receipts.some((receipt) => receipt.kind === 'issuance-hold-accepted'));
    assert.ok(
      result.receipts.some(
        (receipt) =>
          receipt.kind === 'protected-object-read' &&
          receipt.role_arn === result.initial.replacement_role_arn &&
          receipt.outcome === 'completed',
      ),
    );
  }
});

test('premature retirement blocks an admitted pending request', () => {
  for (const family of FAMILIES) {
    const result = run({ seed: 112001, family }, [
      'retire-old-role',
      'hold-issuance',
      'drain-admitted',
      'verify-replacement-read',
    ]);
    assert.equal(result.score.success, false);
    assert.equal(result.score.approved_old_read_completed, false);
  }
});

test('verified replacement route alone does not contain queued issuance', () => {
  for (const family of FAMILIES) {
    const result = run({ seed: 112000, family }, ['drain-admitted', 'verify-replacement-read']);
    assert.equal(result.score.success, false);
    assert.equal(result.score.unauthorized_completed, 1);
  }
});
