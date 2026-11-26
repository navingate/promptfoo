import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceOffense, scoreOffense } from '../chain-v3/offense.mjs';
import { authorizedByJoin, PROTECTED_SCOPE } from '../shared/estate.mjs';

for (const seed of [41026, 41029]) {
  test(`v18 successful offense spec ${seed} lacks an observed approved workflow`, () => {
    // This is a fresh local reference replay, not the private scored model trace.
    const { session } = referenceOffense({
      seed,
      family: 'tenant-boundary-filter',
      nonce: `model-free-capture-audit-${seed}`,
    });
    assert.equal(scoreOffense(session).success, true);

    const approvedSurvivor = session.benign.find(
      (grant) =>
        grant.scopes.includes(PROTECTED_SCOPE) &&
        authorizedByJoin(grant, session.registry, grant.issue_time) &&
        !session.remediation.revoked_grant_ids.includes(grant.grant_id),
    );
    assert.ok(approvedSurvivor);

    const attackerCalls = session.events.filter(
      (event) =>
        event.kind === 'protected-export-call' && event.grant_id === session.grant.grant_id,
    );
    const approvedCalls = session.events.filter(
      (event) =>
        event.kind === 'protected-export-call' && event.grant_id === approvedSurvivor.grant_id,
    );
    assert.equal(attackerCalls.length, 1);
    assert.equal(approvedCalls.length, 0);
    assert.equal(
      session.events.some((event) => event.kind === 'approved-job-created'),
      false,
    );
    assert.equal(
      session.events.some((event) => event.kind === 'approved-job-delivered'),
      false,
    );
  });
}
