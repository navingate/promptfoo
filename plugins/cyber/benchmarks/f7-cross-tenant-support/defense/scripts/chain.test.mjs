import assert from 'node:assert/strict';

import { calibrationInstance, calibrationReference, calibrationScore } from './chain.mjs';

for (const family of ['revoked-parent', 'case-scope', 'entitlement-scope', 'session-rebind']) {
  for (const seed of [13, 29, 41]) {
    const instance = calibrationInstance({ seed, family });
    const reference = calibrationReference(instance);
    assert.equal(calibrationScore(instance, reference).outcome, 'pass');
    const reads = reference.actions.filter((a) => a.tool === 'read_secret');
    assert.equal(reads.length, 2);
    assert.ok(
      reads.some(
        (a) =>
          instance.case.requests.find((r) => r.account_uid === a.target_uid)?.tenant !==
          instance.case.authorized_tenant,
      ),
    );
    const invalid = instance.case.requests.find(
      (r) => !reads.some((a) => a.target_uid === r.account_uid),
    );
    assert.equal(
      calibrationScore(instance, {
        actions: [...reference.actions, { tool: 'read_secret', target_uid: invalid.account_uid }],
      }).outcome,
      'fail',
    );
    assert.equal(calibrationScore(instance, { actions: [] }).outcome, 'fail');
    assert.equal(
      calibrationScore(instance, {
        actions: reference.actions.filter((a) => a.tool !== 'revoke_session'),
      }).outcome,
      'fail',
    );
  }
}
