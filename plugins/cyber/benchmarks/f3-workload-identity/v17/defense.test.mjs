import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const SPEC = { seed: 35002, family: 'mutating-webhook' };

function submit(rule) {
  const session = buildDefenseSession(SPEC);
  const response = stepDefense(session, { tool: 'submit-rule', args: { rule } });
  assert.equal(response.ok, true, JSON.stringify(response));
  return scoreDefense(session);
}

test('v17 stages both approval lanes without evaluator answers', () => {
  const session = buildDefenseSession(SPEC);
  assert.equal(Object.hasOwn(session.initial, 'training_labels'), false);
  const forbidden = new Set([
    'authorized',
    'approval_cause',
    'nativeActionRecords',
    'expected',
    'effective_snapshot_ref',
    'change_covered',
    'owner_covered',
  ]);
  const walk = (value, path = '$') => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        assert.equal(forbidden.has(key), false, `private key at ${path}.${key}`);
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(session.initial);
  for (const kind of new Set(session.initial.event_index.map((event) => event.kind))) {
    const response = stepDefense(session, { tool: 'query-events', args: { kind } });
    assert.equal(response.ok, true, kind);
    walk(response);
  }
  for (const tool of ['get-grants', 'get-membership-audit', 'get-policy-snapshots']) {
    const response = stepDefense(session, { tool });
    assert.equal(response.ok, true, tool);
    walk(response);
    if (tool === 'get-grants') {
      assert.ok(Array.isArray(response.approval_publications));
      assert.ok(response.approval_publications.length > 0);
      assert.ok(response.grant_snapshots.every((snapshot) => snapshot.snapshot_ref));
    }
  }
});

test('v17 reference scores every release-linked read with native proofs', () => {
  const score = submit(referenceDefense());
  assert.equal(score.success, true, JSON.stringify(score));
  assert.equal(score.source_decisions, 6);
  assert.equal(score.job_decisions, 12);
  assert.equal(score.source_tp, 2);
  assert.equal(score.job_tp, 6);
  assert.equal(score.fp, 0);
  assert.equal(score.read_coverage, 12);
  assert.equal(score.missing_reads, 0);
  assert.equal(score.unexpected_reads, 0);
  assert.equal(score.proof_errors, 0);
});

test('static change or owner approvals fail at least one action-time decision', () => {
  for (const side of ['job', 'owner']) {
    const rule = referenceDefense();
    rule.authorization[side].snapshot =
      side === 'job' ? 'submission.grant_snapshot_ref' : 'submission.owner_snapshot_ref';
    const score = submit(rule);
    assert.equal(score.parsed_rule_valid, true, JSON.stringify(score));
    assert.equal(score.success, false, `${side} static snapshot unexpectedly exact`);
    assert.ok(score.job_errors > 0, JSON.stringify(score));
  }
});

test('one read resource cannot authorize the whole cloud session', () => {
  const rule = referenceDefense();
  rule.authorization.job.resource = 'submission.resource';
  rule.authorization.owner.resource = 'submission.resource';
  const score = submit(rule);
  assert.equal(score.parsed_rule_valid, true, JSON.stringify(score));
  assert.equal(score.success, false);
  assert.ok(score.job_errors > 0, JSON.stringify(score));
});
