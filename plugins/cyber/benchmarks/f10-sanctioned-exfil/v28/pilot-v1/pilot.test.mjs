import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPilotCase, CASE_ORDER, gradeDefinition } from './pilot.mjs';

test('each fresh installation context has matched hidden futures and outcome controls', () => {
  for (const index of CASE_ORDER.map((_, slot) => slot)) {
    const item = buildPilotCase(index);
    assert.equal(JSON.stringify(item.futures.early).includes('145'), true);
    assert.equal(JSON.stringify(item.input).includes(item.seed), false);
    assert.equal(gradeDefinition(item.seed, item.answer).exact, true);
    assert.equal(gradeDefinition(item.seed, item.deployed_view).exact, false);
    assert.equal(
      gradeDefinition(item.seed, { ...item.answer, assignment_partition: ['source_report_ref'] })
        .exact,
      false,
    );
    assert.equal(
      gradeDefinition(item.seed, { ...item.answer, receipt_partition: ['source_report_ref'] })
        .exact,
      false,
    );
  }
});
