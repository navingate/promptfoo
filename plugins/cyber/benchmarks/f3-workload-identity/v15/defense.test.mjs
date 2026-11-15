import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession as buildV14Session } from '../v14/defense.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];

test('v15 practice is unlabeled, while v14 training remains labeled', () => {
  const spec = { seed: 30001, family: FAMILIES[0] };
  const candidate = buildDefenseSession(spec);
  const legacy = buildV14Session(spec);
  assert.equal(Object.hasOwn(candidate.initial, 'training_labels'), false);
  assert.equal(Object.hasOwn(legacy.initial, 'training_labels'), true);
  assert.equal(JSON.stringify(candidate.initial).includes('nativeActionRecords'), false);
  assert.equal(/"authorized"\s*:/.test(JSON.stringify(candidate.initial)), false);
  const grants = stepDefense(candidate, { tool: 'get-grants' });
  assert.equal(grants.ok, true);
  assert.ok(
    grants.grant_snapshots.some((snapshot) =>
      snapshot.grants.some((grant) => grant.scope?.controller_id),
    ),
  );
  assert.ok(
    grants.grant_snapshots.some((snapshot) =>
      snapshot.grants.some((grant) => grant.scope?.service_account_id),
    ),
  );
});

test('one version-2 reference rule detects all six incidents across fresh settings', () => {
  for (const seed of [30001, 30002, 30003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const accepted = stepDefense(session, {
        tool: 'submit-rule',
        args: { rule: referenceDefense() },
      });
      assert.equal(accepted.ok, true, `${seed}/${family}`);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}: ${JSON.stringify(score)}`);
      assert.equal(score.parsed_rule_valid, true);
      assert.equal(score.tp, 3);
      assert.equal(score.fp, 0);
      assert.equal(score.fn, 0);
      assert.equal(score.proof_errors, 0);
    }
  }
});
