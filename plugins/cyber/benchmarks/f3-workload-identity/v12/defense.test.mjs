import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDefenseSession as buildNativeWorld,
  referenceDefense as referenceNativeDefense,
  scoreDefense as scoreNativeDefense,
  stepDefense as stepNativeDefense,
} from '../v9/defense.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

test('each target Job read has a native completed same-session operational neighbor', () => {
  const world = buildNativeWorld({ seed: 22801, family: 'reconcile-hook', linkAmbiguity: true });
  const orders = new Set();
  for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
    const target = world.events.find((event) => event.event_id === record.job.action.event_id);
    assert.ok(target, tokenId);
    const peers = world.events.filter(
      (event) =>
        event.kind === 'cloud-object-read' &&
        event.access_key_ref === target.access_key_ref &&
        event.causal_ref === target.causal_ref &&
        event.outcome === 'completed',
    );
    assert.equal(peers.length, 2);
    assert.notEqual(peers[0].resource, peers[1].resource);
    const operational = peers.find((event) => event.event_id !== target.event_id);
    assert.equal(record.operational.read_event_id, operational.event_id);
    assert.equal(record.operational.authorization_snapshot_ref, operational.authorization_snapshot_ref);
    assert.equal(record.operational.outcome, 'completed');
    orders.add(peers[0].event_id === target.event_id ? 'target-first' : 'neighbor-first');
  }
  assert.deepEqual(orders, new Set(['target-first', 'neighbor-first']));
  const nativeLabels = referenceNativeDefense(world);
  stepNativeDefense(world, { tool: 'submit', args: { labels: nativeLabels } });
  assert.equal(scoreNativeDefense(world).success, true);
});

test('reference rule remains exact and access-key-only rule fails by ambiguity', () => {
  const spec = { seed: 22801, family: 'reconcile-hook' };
  const good = buildDefenseSession(spec);
  stepDefense(good, { tool: 'submit-rule', args: { rule: referenceDefense() } });
  assert.equal(scoreDefense(good).success, true);

  const weakRule = referenceDefense();
  weakRule.joins.jobCloud = [
    { from: 'roleSts', left: 'access_key_ref', right: 'access_key_ref' },
  ];
  const weak = buildDefenseSession(spec);
  stepDefense(weak, { tool: 'submit-rule', args: { rule: weakRule } });
  const score = scoreDefense(weak);
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.success, false);
  assert.ok(score.join_errors > 0 || score.proof_errors > 0);
});

test('the original native producer has no added operational read', () => {
  const world = buildNativeWorld({ seed: 22801, family: 'reconcile-hook' });
  for (const record of Object.values(world.nativeActionRecords)) {
    assert.equal(record.operational, undefined);
  }
});
