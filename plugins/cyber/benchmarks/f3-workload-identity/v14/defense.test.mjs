import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession as buildV13Session, stepDefense as stepV13 } from '../v13/defense.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const REDACTED_KINDS = [
  'cloud-secret-attempt',
  'synced-secret-read',
  'runtime-credential-request',
  'sts-assume-web-identity',
  'sts-assume-role',
  'cloud-object-read',
];

test('v14 omits direct cross-plane causal refs from every training query', () => {
  const session = buildDefenseSession({ seed: 22901, family: 'reconcile-hook' });
  for (const kind of REDACTED_KINDS) {
    const response = stepDefense(session, { tool: 'query-events', args: { kind } });
    assert.equal(response.ok, true);
    assert.ok(response.events.length > 0);
    assert.ok(response.events.every((event) => !Object.hasOwn(event, 'causal_ref')));
  }
});

test('v13 training events retain their causal references', () => {
  const session = buildV13Session({ seed: 22901, family: 'reconcile-hook' });
  const response = stepV13(session, {
    tool: 'query-events',
    args: { kind: 'synced-secret-read' },
  });
  assert.ok(response.events.some((event) => Object.hasOwn(event, 'causal_ref')));
});

test('field-based reference resolves the complete de-oracled chain', () => {
  for (const family of ['reconcile-hook', 'mutating-webhook', 'owner-reference']) {
    const session = buildDefenseSession({ seed: 22901, family });
    const response = stepDefense(session, {
      tool: 'submit-rule',
      args: { rule: referenceDefense() },
    });
    assert.equal(response.ok, true);
    assert.equal(scoreDefense(session).success, true, family);
  }
});

test('a direct causal-ref shortcut fails under the v14 projection', () => {
  const session = buildDefenseSession({ seed: 22901, family: 'reconcile-hook' });
  const rule = referenceDefense();
  rule.joins.sourceRead = [{ from: 'sourceCloud', left: 'causal_ref', right: 'causal_ref' }];
  stepDefense(session, { tool: 'submit-rule', args: { rule } });
  const score = scoreDefense(session);
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.success, false);
  assert.ok(score.missing_joins > 0);
});
