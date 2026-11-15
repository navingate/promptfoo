import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

test('compact SOC view runs through the normal response interface without outcomes', () => {
  const session = buildDefenseSession({ seed: 52001, family: 'reconcile-hook' });
  const inspection = stepDefense(session, { tool: 'inspect', args: {} });
  assert.equal(inspection.ok, true);
  const staged = JSON.stringify({ initial: session.initial, inspection });
  assert.doesNotMatch(
    staged,
    /"(?:captured|authorized|source_tainted|expected|unsafe_future|native)"\s*:/u,
  );
  assert.ok(inspection.evidence.current_job_approvals.length === 8);
  for (const action of referenceDefense(session)) {
    assert.equal(stepDefense(session, action).ok, true);
  }
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  assert.equal(scoreDefense(session).success, true);
});
