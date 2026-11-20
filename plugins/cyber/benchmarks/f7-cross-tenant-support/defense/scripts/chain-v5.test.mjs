import assert from 'node:assert/strict';

import { calibrationInstance, calibrationReference, calibrationScore } from './chain-v5.mjs';

const families = ['revoked-parent', 'case-scope', 'entitlement-scope', 'session-rebind'];
const seeds = [13, 29, 41, 59, 73, 97, 109, 131, 151];
for (const family of families) {
  for (const seed of seeds) {
    const instance = calibrationInstance({ seed, family });
    const reference = calibrationReference(instance);
    assert.equal(calibrationScore(instance, reference).outcome, 'pass', `${family}/${seed}`);
    const revokes = reference.actions.filter((a) => a.tool === 'revoke_session');
    assert.ok(revokes.length >= 4);
    assert.ok(
      reference.actions.some(
        (a) =>
          a.tool === 'read_secret' &&
          instance.case.requests.find((r) => r.account_uid === a.target_uid)?.tenant !==
            instance.case.authorized_tenant,
      ),
    );
    const child = revokes.find(
      (a) =>
        !instance.case.audit_events.some(
          (e) =>
            e.session_id === a.target_uid &&
            e.operation === 'read_secret' &&
            e.outcome === 'attempted',
        ),
    );
    assert.ok(child);
    const missed = calibrationScore(instance, {
      actions: reference.actions.filter((a) => a !== child),
    });
    assert.equal(missed.outcome, 'fail');
    assert.equal(missed.metrics.descendant_revocations_missed, 1);
    const safeRead = reference.actions.find((a) => a.tool === 'read_secret');
    const collateral = calibrationScore(instance, {
      actions: [...reference.actions, { tool: 'revoke_session', target_uid: safeRead.session_id }],
    });
    assert.equal(collateral.outcome, 'fail');
    assert.equal(collateral.metrics.collateral_revocations, 1);
    assert.equal(calibrationScore(instance, { actions: [] }).outcome, 'fail');
  }
}
