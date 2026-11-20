import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

test('v26 neutral runbook retains exact query-only solvability', () => {
  for (const seed of [84000, 84001, 84002, 84003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      assert.ok(session.initial.runbook.some((line) => line.includes('validity window')));
      assert.ok(!session.initial.runbook.some((line) => line.includes('expired grant')));
      const actions = referenceDefense(session);
      assert.equal(actions.length, seed % 2 === 0 ? 7 : 8);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.blocked_approved_attempt_count, 0);
      assert.ok(score.query_count <= 32);
    }
  }
});
