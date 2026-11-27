import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPilotCase, CASE_ORDER } from './pilot.mjs';

test('two fresh installation contexts vary while future request cells remain private', () => {
  assert.equal(CASE_ORDER.length, 2);
  const cases = CASE_ORDER.map((_, index) => buildPilotCase(index));
  assert.notEqual(cases[0].context.source_stage_ref, cases[1].context.source_stage_ref);
  assert.notEqual(cases[0].context.recipient_id, cases[1].context.recipient_id);
  for (const item of cases) {
    assert.equal(item.input.includes('release-worker.mjs'), true);
    assert.equal(JSON.stringify(item.context).includes('cell_key'), false);
    assert.equal(JSON.stringify(item.context).includes('request_id'), false);
    assert.equal(item.input.includes(String(item.seed)), false);
  }
});
