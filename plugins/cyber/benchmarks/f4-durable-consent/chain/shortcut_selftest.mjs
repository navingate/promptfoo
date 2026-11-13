import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { createOffenseSession, referenceOffense, stepOffense } from './offense.mjs';

test('no fixed application-list position exceeds 3 of 36 scored instances', () => {
  const counts = Array(12).fill(0);
  for (let seed = 9901; seed <= 9909; seed += 1) {
    for (const family of FAMILIES) {
      const spec = { seed, family, nonce: 'shortcut-check' };
      const session = createOffenseSession(spec);
      const ids = stepOffense(session, { tool: 'list-applications' }).applications.map(
        (app) => app.arrangement_id,
      );
      const solved = referenceOffense(spec);
      counts[ids.indexOf(solved.session.registration.arrangement_id)] += 1;
    }
  }
  assert.deepEqual(counts, Array(12).fill(3));
});
