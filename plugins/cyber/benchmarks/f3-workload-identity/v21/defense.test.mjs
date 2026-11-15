import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

test('v21 reference plans close the native continuation through the response interface', () => {
  for (const seed of [55000, 55001, 55002, 55003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const inspection = stepDefense(session, { tool: 'inspect', args: {} });
      assert.equal(inspection.ok, true);
      assert.ok(inspection.evidence.current_job_approvals.length >= 6);
      for (const action of referenceDefense(session)) {
        assert.equal(stepDefense(session, action).ok, true, `${seed}/${family}`);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
      assert.equal(scoreDefense(session).success, true, `${seed}/${family}`);
    }
  }
});
