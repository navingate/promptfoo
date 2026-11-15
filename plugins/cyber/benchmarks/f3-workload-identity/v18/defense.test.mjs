import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, scoreDefense, stepDefense } from './defense.mjs';

const SPEC = { seed: 36001, family: 'reconcile-hook' };

test('the triage interface hides native outcomes and returns isolated evidence', () => {
  const session = buildDefenseSession(SPEC);
  assert.equal(session.finished, false);
  assert.equal(scoreDefense(session).reason, 'unsubmitted');
  const first = stepDefense(session, { tool: 'inspect', args: {} });
  assert.equal(first.ok, true);
  assert.ok(first.evidence.events.length > 0);
  assert.ok(first.evidence.session_register.length > 0);
  assert.ok(first.evidence.job_queue.length > 0);
  const staged = JSON.stringify({ initial: session.initial, inspection: first });
  assert.doesNotMatch(
    staged,
    /"(?:unauthorized|malicious|effective_action|threat_closed|function_preserved|future_attempts|captured)"\s*:/u,
  );
  const originalId = first.evidence.events[0].event_id;
  first.evidence.events[0].event_id = 'mutated';
  assert.equal(
    stepDefense(session, { tool: 'inspect', args: {} }).evidence.events[0].event_id,
    originalId,
  );
});

test('actions return control-plane acceptance without replay or score feedback', () => {
  const session = buildDefenseSession(SPEC);
  const evidence = stepDefense(session, { tool: 'inspect', args: {} }).evidence;
  const job = evidence.job_queue[0];
  const response = stepDefense(session, { tool: 'pause-job', args: { job_uid: job.job_uid } });
  assert.equal(response.ok, true);
  assert.doesNotMatch(
    JSON.stringify(response),
    /threat_closed|function_preserved|attempt_results|success/u,
  );
  const final = stepDefense(session, { tool: 'submit-plan', args: {} });
  assert.equal(final.ok, true);
  assert.equal(session.finished, true);
  const score = scoreDefense(session);
  assert.equal(typeof score.threat_closed, 'boolean');
  assert.equal(typeof score.function_preserved, 'boolean');
  assert.equal(typeof score.success, 'boolean');
});

test('malformed or out-of-scope action cannot silently pass', () => {
  const session = buildDefenseSession(SPEC);
  assert.equal(stepDefense(session, { tool: 'pause-job', args: { job_uid: 'unknown' } }).ok, false);
  assert.equal(stepDefense(session, { tool: 'unknown-tool', args: {} }).ok, false);
  stepDefense(session, { tool: 'submit-plan', args: {} });
  const score = scoreDefense(session);
  assert.equal(score.success, false);
  assert.ok(score.invalid_actions > 0);
});
