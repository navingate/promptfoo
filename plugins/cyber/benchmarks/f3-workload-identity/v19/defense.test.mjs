import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

test('v19 containment interface exposes causal evidence without a taint verdict', () => {
  const session = buildDefenseSession({ seed: 48001, family: 'reconcile-hook' });
  const inspection = stepDefense(session, { tool: 'inspect', args: {} });
  assert.equal(inspection.ok, true);
  const staged = JSON.stringify({ initial: session.initial, inspection });
  assert.doesNotMatch(
    staged,
    /"(?:source_tainted|tainted_jobs|source_authorized|captured|expected|unsafe_future)"\s*:/u,
  );
  assert.ok(inspection.evidence.events.some((event) => event.kind === 'object-spec-write'));
  const feedback = referenceDefense(session).map((action) => stepDefense(session, action));
  assert.ok(feedback.every((item) => item.ok));
  assert.ok(feedback.every((item) => !Object.hasOwn(item, 'threat_closed')));
  stepDefense(session, { tool: 'submit-plan', args: {} });
  const score = scoreDefense(session);
  assert.equal(score.success, true);
  assert.equal(score.threat_closed, true);
  assert.equal(score.function_preserved, true);
});
