import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession as buildNativeWorld } from '../v9/defense.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { REFERENCE_RULE } from './rule.mjs';

const spec = { seed: 22801, family: FAMILIES[0] };
const training = buildNativeWorld({ ...spec, seed: spec.seed + 100_000 });
const hidden = buildNativeWorld(spec);
const session = buildDefenseSession(spec);
const unsubmittedScore = scoreDefense(session);
assert.equal(unsubmittedScore.reason, 'unsubmitted');
assert.equal(unsubmittedScore.off_grammar, 0);
assert.equal(unsubmittedScore.invalid_rule, 0);
assert.equal(unsubmittedScore.parsed_rule_valid, false);
assert.equal(unsubmittedScore.success, false);
const hiddenIds = new Set([
  ...hidden.events.map((event) => event.event_id),
  ...hidden.membershipAudit.map((event) => event.event_id),
]);
const forbidden = new Set([
  ...hiddenIds,
  ...Object.keys(hidden.expected),
  ...Object.values(hidden.nativeActionRecords).flatMap((record) => [
    record.source.action.event_id,
    record.job.action.event_id,
    record.background.action.event_id,
  ]),
]);

function noHidden(value) {
  const output = JSON.stringify(value);
  for (const id of forbidden) {
    assert.equal(output.includes(id), false, `hidden identifier leaked: ${id}`);
  }
  assert.equal(output.includes('nativeActionRecords'), false);
  assert.equal(output.includes('expected'), false);
}

noHidden(session.initial);
assert.deepEqual(session.initial.training_labels, training.expected);
assert.deepEqual(session.initial.event_index, training.initial.event_index);
assert.notDeepEqual(session.initial.event_index, hidden.initial.event_index);
assert.equal(JSON.stringify(session).includes('nativeActionRecords'), false);
assert.equal(JSON.stringify(session).includes('expected'), false);

for (const kind of new Set(training.events.map((event) => event.kind))) {
  const response = stepDefense(session, { tool: 'query-events', args: { kind } });
  assert.equal(response.ok, true);
  assert.deepEqual(
    response.events,
    training.events.filter((event) => event.kind === kind),
  );
  noHidden(response);
}
for (const [tool, key, expected] of [
  ['get-grants', 'grant_snapshots', training.grantSnapshots],
  ['get-membership-audit', 'events', training.membershipAudit],
  ['get-policy-snapshots', 'policy_snapshots', training.policySnapshots],
]) {
  const response = stepDefense(session, { tool });
  assert.equal(response.ok, true);
  assert.deepEqual(response[key], expected);
  noHidden(response);
}
for (let i = session.queries; i < 24; i += 1) {
  assert.equal(stepDefense(session, { tool: 'query-events', args: { kind: 'absent' } }).ok, true);
}
assert.deepEqual(stepDefense(session, { tool: 'get-grants' }), {
  ok: false,
  reason: 'query-budget-exhausted',
});
assert.equal(session.queries, 25);
assert.deepEqual(stepDefense(session, { tool: 'submit', args: { labels: hidden.expected } }), {
  ok: false,
  reason: 'unknown-tool',
});
assert.equal(session.finished, false);

const rule = referenceDefense(session);
assert.deepEqual(rule, REFERENCE_RULE);
rule.version = 999;
assert.equal(REFERENCE_RULE.version, 1);
// Poison public-looking fields before execution; neither the interpreter nor
// scorer may consult them for the hidden world.
session.expected = Object.fromEntries(
  Object.keys(hidden.expected).map((id) => [id, 'approved-automation']),
);
session.nativeActionRecords = {};
session.initial.training_labels[Object.keys(training.expected)[0]] = 'approved-automation';
const accepted = stepDefense(session, { tool: 'submit-rule', args: { rule: REFERENCE_RULE } });
assert.deepEqual(accepted, { ok: true, finished: true });
noHidden(accepted);
assert.deepEqual(stepDefense(session, { tool: 'submit-rule', args: { rule: REFERENCE_RULE } }), {
  ok: false,
  reason: 'session-finished',
});
const scored = scoreDefense(session);
assert.equal(scored.success, true);
assert.equal(scored.exact_batch, true);
assert.equal(scored.label_only_exact, true);
assert.equal(scored.parsed_rule_valid, true);
assert.equal(scored.proof_errors, 0);
assert.equal(scored.fp, 0);
assert.equal(scored.fn, 0);
assert.equal(scored.tp, 3);
assert.equal(scored.missing_joins, 0);
assert.equal(scored.ambiguous_joins, 0);

// Repeated scoring still uses the captured native truth.
assert.equal(scoreDefense(session).success, true);
session.finished = false;
assert.equal(
  stepDefense(session, { tool: 'submit-rule', args: { rule: { version: 1 } } }).reason,
  'session-finished',
);
assert.equal(scoreDefense(session).success, true);

const malformed = buildDefenseSession(spec);
assert.deepEqual(
  stepDefense(malformed, { tool: 'submit-rule', args: { labels: hidden.expected } }),
  {
    ok: false,
    finished: true,
    reason: 'off-grammar',
  },
);
assert.equal(scoreDefense(malformed).off_grammar, 1);
assert.equal(scoreDefense(malformed).invalid_rule, 0);
assert.equal(scoreDefense(malformed).reason, 'off-grammar');
assert.equal(stepDefense(malformed, { tool: 'get-grants' }).reason, 'session-finished');
malformed.finished = false;
assert.equal(
  stepDefense(malformed, { tool: 'submit-rule', args: { rule: REFERENCE_RULE } }).reason,
  'session-finished',
);
assert.equal(scoreDefense(malformed).off_grammar, 1);

const invalid = buildDefenseSession(spec);
assert.deepEqual(stepDefense(invalid, { tool: 'submit-rule', args: { rule: { version: 1 } } }), {
  ok: false,
  finished: true,
  reason: 'invalid-rule',
});
assert.equal(scoreDefense(invalid).off_grammar, 0);
assert.equal(scoreDefense(invalid).invalid_rule, 1);
assert.equal(scoreDefense(invalid).reason, 'invalid-rule');
invalid.finished = false;
assert.deepEqual(stepDefense(invalid, { tool: 'get-grants' }), {
  ok: false,
  reason: 'session-finished',
});
assert.equal(invalid.finished, true);
assert.deepEqual(stepDefense(invalid, { tool: 'submit-rule', args: { rule: REFERENCE_RULE } }), {
  ok: false,
  reason: 'session-finished',
});
assert.equal(scoreDefense(invalid).reason, 'invalid-rule');
assert.equal(scoreDefense(invalid).success, false);

const wrongRule = structuredClone(REFERENCE_RULE);
wrongRule.authorization.alert.downstream = 'completed-kms';
const wrong = buildDefenseSession(spec);
assert.equal(stepDefense(wrong, { tool: 'submit-rule', args: { rule: wrongRule } }).ok, true);
const wrongScore = scoreDefense(wrong);
assert.equal(wrongScore.label_only_exact, false);
assert.ok(wrongScore.errors > 0);
assert.ok(wrongScore.subtype_errors > 0);
assert.equal(wrongScore.proof_errors, 0);

const falseAlarmRule = structuredClone(REFERENCE_RULE);
falseAlarmRule.authorization.source.time = 'sourceCloud.arrival_order';
const falseAlarm = buildDefenseSession(spec);
assert.equal(
  stepDefense(falseAlarm, { tool: 'submit-rule', args: { rule: falseAlarmRule } }).ok,
  true,
);
const falseAlarmScore = scoreDefense(falseAlarm);
assert.ok(falseAlarmScore.fp > 0);
assert.equal(falseAlarmScore.false_alarm_load, falseAlarmScore.fp);
assert.equal(falseAlarmScore.proof_errors, 0);

const missingJoinRule = structuredClone(REFERENCE_RULE);
missingJoinRule.joins.jobCloud[1].left = 'source_access_key_ref';
const missingJoin = buildDefenseSession(spec);
assert.equal(
  stepDefense(missingJoin, { tool: 'submit-rule', args: { rule: missingJoinRule } }).ok,
  true,
);
const missingJoinScore = scoreDefense(missingJoin);
assert.equal(missingJoinScore.parsed_rule_valid, true);
assert.equal(missingJoinScore.missing_joins, 6);
assert.equal(missingJoinScore.missing_proofs, 12);

const ambiguousJoinRule = structuredClone(REFERENCE_RULE);
ambiguousJoinRule.joins.jobCloud = [{ from: 'submission', left: 'resource', right: 'resource' }];
const ambiguousJoin = buildDefenseSession(spec);
assert.equal(
  stepDefense(ambiguousJoin, { tool: 'submit-rule', args: { rule: ambiguousJoinRule } }).ok,
  true,
);
assert.equal(scoreDefense(ambiguousJoin).ambiguous_joins, 6);

// Independent native worlds retain the same three actionable and three approved
// incidents, with a different access key for every same-object background read.
let referenceCount = 0;
let sawBackgroundFirst = false;
let sawTargetFirst = false;
for (const family of FAMILIES) {
  for (let seed = 22801; seed <= 22812; seed += 1) {
    const world = buildNativeWorld({ seed, family });
    const labels = Object.values(world.expected);
    assert.equal(labels.filter((label) => label === 'approved-automation').length, 3);
    assert.equal(labels.filter((label) => label !== 'approved-automation').length, 3);
    assert.deepEqual(labels, [
      'full-cascade',
      'approved-automation',
      'source-cascade',
      'approved-automation',
      'job-cascade',
      'approved-automation',
    ]);
    assert.ok(
      world.events.some(
        (event) => event.kind === 'broker-token-issued' && event.outcome === 'denied',
      ),
    );
    assert.ok(
      world.events.some((event) => event.kind === 'kms-decrypt' && event.outcome === 'denied'),
    );
    for (const native of Object.values(world.nativeActionRecords)) {
      assert.equal(native.job.action.resource, native.background.action.resource);
      assert.notEqual(native.job.action.event_id, native.background.action.event_id);
      const targetArrival = world.events.find(
        (event) => event.event_id === native.job.action.event_id,
      )?.arrival_order;
      const backgroundArrival = world.events.find(
        (event) => event.event_id === native.background.action.event_id,
      )?.arrival_order;
      const targetRead = world.events.find(
        (event) => event.event_id === native.job.action.event_id,
      );
      const backgroundRead = world.events.find(
        (event) => event.event_id === native.background.action.event_id,
      );
      assert.notEqual(targetRead.access_key_ref, backgroundRead.access_key_ref);
      assert.equal(targetRead.resource, backgroundRead.resource);
      assert.equal(targetRead.actor, backgroundRead.actor);
      assert.equal(targetRead.outcome, 'completed');
      assert.equal(backgroundRead.outcome, 'completed');
      if (backgroundArrival < targetArrival) {
        sawBackgroundFirst = true;
      } else {
        sawTargetFirst = true;
      }
    }
    const records = Object.values(world.nativeActionRecords);
    for (const [bad, approved] of [
      [0, 1],
      [2, 3],
      [4, 5],
    ]) {
      const badRead = world.events.find(
        (event) => event.event_id === records[bad].job.action.event_id,
      );
      const approvedRead = world.events.find(
        (event) => event.event_id === records[approved].job.action.event_id,
      );
      for (const field of ['actor', 'resource', 'action', 'outcome']) {
        assert.equal(badRead[field], approvedRead[field]);
      }
      assert.equal(records[bad].source.grants.length, records[approved].source.grants.length);
      assert.equal(records[bad].job.grants.length, records[approved].job.grants.length);
      assert.equal(records[bad].source.ledger.length, records[approved].source.ledger.length);
      assert.equal(records[bad].job.ledger.length, records[approved].job.ledger.length);
    }
    const candidate = buildDefenseSession({ seed, family });
    assert.equal(
      stepDefense(candidate, { tool: 'submit-rule', args: { rule: referenceDefense(candidate) } })
        .ok,
      true,
    );
    const result = scoreDefense(candidate);
    assert.equal(
      result.success,
      true,
      `reference failed on ${family}/${seed}: ${JSON.stringify(result)}`,
    );
    assert.equal(result.fp, 0);
    assert.equal(result.proof_errors, 0);
    referenceCount += 1;
  }
}
assert.equal(referenceCount, 36);
assert.equal(sawBackgroundFirst, true);
assert.equal(sawTargetFirst, true);

console.log('v10 defense self-test passed (36 native hidden worlds)');
