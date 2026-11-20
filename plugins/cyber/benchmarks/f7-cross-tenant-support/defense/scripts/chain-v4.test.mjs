import assert from 'node:assert/strict';

import { calibrationInstance, calibrationReference, calibrationScore } from './chain-v4.mjs';

for (const family of ['revoked-parent', 'case-scope', 'entitlement-scope', 'session-rebind']) {
  for (const seed of [13, 29, 41, 59, 73, 97, 109, 131, 151]) {
    const instance = calibrationInstance({ seed, family });
    const ref = calibrationReference(instance);
    const verdict = calibrationScore(instance, ref);
    assert.equal(verdict.outcome, 'pass', `${family}/${seed}: reference`);
    assert.ok(
      ref.actions.some(
        (a) =>
          a.tool === 'read_secret' &&
          instance.case.requests.find((r) => r.account_uid === a.target_uid)?.tenant !==
            instance.case.authorized_tenant,
      ),
    );
    assert.ok(ref.actions.filter((a) => a.tool === 'revoke_session').length >= 2);
    const compromised = instance.case.compromised_session_example;
    assert.equal(compromised, undefined);
    const alternate = instance.case.support_sessions.find((s) =>
      ref.actions.some(
        (a) =>
          a.tool === 'read_secret' &&
          a.session_id === s.session_id &&
          a.session_id !==
            instance.case.requests.find((r) => r.account_uid === a.target_uid)?.session_id,
      ),
    );
    assert.ok(alternate);
    const targetRead = ref.actions.find(
      (a) => a.tool === 'read_secret' && a.session_id === alternate.session_id,
    );
    const primary = instance.case.requests.find(
      (r) => r.account_uid === targetRead.target_uid,
    ).session_id;
    const unsafePrimary = ref.actions.map((a) =>
      a === targetRead ? { ...a, session_id: primary } : a,
    );
    assert.equal(calibrationScore(instance, { actions: unsafePrimary }).outcome, 'fail');
    assert.equal(
      calibrationScore(instance, { actions: unsafePrimary }).metrics.compromised_session_reads,
      1,
    );
    const reordered = [...ref.actions];
    const firstRead = reordered.findIndex((a) => a.tool === 'read_secret');
    const [read] = reordered.splice(firstRead, 1);
    reordered.unshift(read);
    assert.equal(calibrationScore(instance, { actions: reordered }).outcome, 'fail');
    assert.equal(calibrationScore(instance, { actions: [] }).outcome, 'fail');
  }
}
