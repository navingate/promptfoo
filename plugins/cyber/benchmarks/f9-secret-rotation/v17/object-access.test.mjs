import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../v10/graph.mjs';
import {
  createGrantStageSession,
  inferGrant,
  inferReadVersion,
  referenceGrantStage,
  referenceOffense,
  scoreOffense,
  stepOffense,
} from './offense.mjs';

const act = (session, tool, args = {}) => stepOffense(session, { tool, args });
const spec = { seed: 110001, family: 'cached-interval' };
const effective = (events, versionId, at) =>
  events
    .filter(
      (event) =>
        event.version_id === versionId && event.event_time <= at && event.effective_at <= at,
    )
    .sort((a, b) => b.effective_at - a.effective_at || b.event_time - a.event_time)[0];

function grantStage() {
  const session = createGrantStageSession(spec);
  const receipt = session.initial.receipt;
  const catalog = act(session, 'grants', { receipt });
  const events = act(session, 'grant-events', { receipt }).events;
  const grant = inferGrant({ ...catalog, events });
  const redeemed = act(session, 'redeem-grant', { receipt, grant });
  assert.equal(redeemed.allowed, true);
  return { session, token: redeemed.read_token };
}

test('two published object versions require a separate principal-scoped access permit', () => {
  const { session, token } = grantStage();
  const objects = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  assert.ok(Array.isArray(access.permits));
  assert.ok(Array.isArray(access.events));
  assert.equal(access.context.principal, objects.context.principal);
  assert.ok(
    access.events.some(
      (event) => event.status === 'revoked' && event.effective_at > objects.context.at,
    ),
  );
  const published = objects.versions.filter((version) => {
    const current = effective(objects.events, version.id, objects.context.at);
    return current?.status === 'published' && current.deployment_ref === objects.context.deployment;
  });
  assert.ok(published.length >= 2);
  const selected = inferReadVersion({
    ...objects,
    permits: access.permits,
    permitEvents: access.events,
  });
  assert.ok(selected);
  assert.ok(published.some((version) => version.id === selected));
  assert.equal(act(session, 'access-policies', { token: 'invalid' }).error, 'invalid-read-token');
});

test('one-shot protected read rejects a published version without an active permit', () => {
  const { session, token } = grantStage();
  const objects = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  const selected = inferReadVersion({
    ...objects,
    permits: access.permits,
    permitEvents: access.events,
  });
  const wrong = objects.versions.find((version) => {
    const current = effective(objects.events, version.id, objects.context.at);
    return (
      version.id !== selected &&
      current?.status === 'published' &&
      current.deployment_ref === objects.context.deployment
    );
  });
  assert.ok(wrong);
  const denied = act(session, 'protected-read', { token, version: wrong.id });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'object-access-denied');
  assert.equal(scoreOffense(session).success, false);
  assert.equal(
    act(session, 'protected-read', { token, version: selected }).error,
    'read-budget-exhausted',
  );
});

test('visible reference joins publication and permit histories across fresh seeds', () => {
  for (let seed = 110001; seed <= 110012; seed += 1) {
    for (const family of FAMILIES) {
      const result = referenceOffense({ seed, family });
      assert.equal(result.score.success, true, `${seed}/${family}`);
      const read = result.session.ledger.find((event) => event.type === 'protected.read');
      assert.ok(read.permit_id);
      assert.ok(read.permit_status_event_id);
    }
  }
  assert.equal(referenceGrantStage(spec).score.success, true);
});
