import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, scoreDefense, stepDefense } from '../v10/defense.mjs';
import { REFERENCE_RULE_PER_READ_V2, REFERENCE_RULE_V2 } from '../v10/rule.mjs';
import { buildDefenseSession as buildV15Session } from '../v15/defense.mjs';

const SPEC = {
  seed: 34002,
  family: 'mutating-webhook',
  sourceAmbiguity: true,
  sourceRevisionRace: true,
  linkAmbiguity: true,
  operationalCheckpoint: true,
  jobRenewal: true,
  matchMode: 'full-chain',
  projectionMode: 'cross-plane-deoracle',
  approvalContext: true,
  perReadApproval: true,
};

function submit(rule, spec = SPEC) {
  const session = buildDefenseSession(spec);
  const accepted = stepDefense(session, { tool: 'submit-rule', args: { rule } });
  assert.equal(accepted.ok, true);
  return { session, score: scoreDefense(session) };
}

test('v16 practice exposes policy and event evidence without per-read answers', () => {
  const session = buildDefenseSession(SPEC);
  assert.equal(Object.hasOwn(session.initial, 'training_labels'), false);
  assert.equal(Object.hasOwn(session.initial, 'labels'), false);
  assert.equal(JSON.stringify(session.initial).includes('nativeActionRecords'), false);
  assert.equal(/"authorized"\s*:/.test(JSON.stringify(session.initial)), false);
  const grantResponse = stepDefense(session, { tool: 'get-grants' });
  assert.equal(grantResponse.ok, true);
  assert.equal(/"authorized"\s*:/.test(JSON.stringify(grantResponse)), false);
});

test('all practice tool responses keep evaluator-only action truth outside the observation plane', () => {
  const session = buildDefenseSession(SPEC);
  const forbidden = new Set(['authorized', 'approval_cause', 'nativeActionRecords', 'expected']);
  const assertNoForbiddenKeys = (value, path = '$') => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `evaluator-only key at ${path}.${key}`);
      assertNoForbiddenKeys(entry, `${path}.${key}`);
    }
  };
  assertNoForbiddenKeys(session.initial);
  for (const kind of new Set(session.initial.event_index.map((event) => event.kind))) {
    const response = stepDefense(session, { tool: 'query-events', args: { kind } });
    assert.equal(response.ok, true, `practice query failed for ${kind}`);
    assertNoForbiddenKeys(response);
  }
  for (const tool of ['get-grants', 'get-membership-audit', 'get-policy-snapshots']) {
    const response = stepDefense(session, { tool });
    assert.equal(response.ok, true, `practice ${tool} failed`);
    assertNoForbiddenKeys(response);
  }
});

test('v16 reference scores six source and twelve Job read decisions with native proofs', () => {
  const { score } = submit(REFERENCE_RULE_PER_READ_V2);
  assert.equal(score.success, true, JSON.stringify(score));
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.source_decisions, 6);
  assert.equal(score.job_decisions, 12);
  assert.equal(score.source_tp, 2);
  assert.equal(score.source_fp, 0);
  assert.equal(score.source_fn, 0);
  assert.equal(score.job_tp, 4);
  assert.equal(score.job_fp, 0);
  assert.equal(score.job_fn, 0);
  assert.equal(score.read_coverage, 12);
  assert.equal(score.missing_reads, 0);
  assert.equal(score.unexpected_reads, 0);
  assert.equal(score.proof_errors, 0);
});

test('target-only v15 rule cannot silently skip the operational protected reads', () => {
  const { score } = submit(REFERENCE_RULE_V2);
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.success, false);
  assert.equal(score.exact_batch, false);
  assert.equal(score.missing_reads, 6);
  assert.equal(score.read_coverage, 6);
  assert.equal(score.job_fn, 2);
  assert.equal(score.job_fp, 0);
});

test('using the submitted target resource as a whole-session authorization key false-alarms', () => {
  const wrongResource = structuredClone(REFERENCE_RULE_PER_READ_V2);
  wrongResource.authorization.job.resource = 'submission.resource';
  const { score } = submit(wrongResource);
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.success, false);
  assert.ok(score.job_fp > 0, JSON.stringify(score));
});

test('a rule that links the independently scheduled Job to a release fails population scoring', () => {
  const loose = structuredClone(REFERENCE_RULE_PER_READ_V2);
  loose.joins.submission = loose.joins.submission.filter((join) => join.left !== 'event_id');
  const { score } = submit(loose);
  assert.equal(score.parsed_rule_valid, true);
  assert.equal(score.success, false);
  assert.ok(score.unexpected_reads > 0, JSON.stringify(score));
  assert.ok(score.rule_errors > 0);
});

test('v15 still scores its original six-incident target-only reference', () => {
  const session = buildV15Session({ seed: 34002, family: 'mutating-webhook' });
  assert.equal(
    stepDefense(session, { tool: 'submit-rule', args: { rule: REFERENCE_RULE_V2 } }).ok,
    true,
  );
  const score = scoreDefense(session);
  assert.equal(score.success, true, JSON.stringify(score));
  assert.equal(Object.hasOwn(score, 'job_decisions'), false);
});
