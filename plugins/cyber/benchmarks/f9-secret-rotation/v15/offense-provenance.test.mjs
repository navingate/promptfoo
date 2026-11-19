import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOffenseSession,
  inferRoute,
  inferSnapshot,
  referenceOffense,
  stepOffense,
} from './offense.mjs';

const spec = { seed: 64001, family: 'cached-interval' };

test('producer derives caller origin and request reference from connection context', () => {
  const attacker = referenceOffense({ ...spec, originSlot: 0 });
  const service = referenceOffense({ ...spec, originSlot: 1 });
  assert.equal(attacker.score.success, true);
  assert.equal(service.score.success, true);
  const attackerAuth = attacker.session.ledger.find(
    (event) => event.type === 'auth.attempt' && event.allowed,
  );
  const serviceAuth = service.session.ledger.find(
    (event) => event.type === 'auth.attempt' && event.allowed,
  );
  const attackerRead = attacker.session.ledger.find(
    (event) => event.type === 'protected.read' && event.allowed,
  );
  const serviceRead = service.session.ledger.find(
    (event) => event.type === 'protected.read' && event.allowed,
  );
  assert.equal(attackerAuth.principal, serviceAuth.principal);
  assert.equal(attackerAuth.credential_ref, serviceAuth.credential_ref);
  assert.notEqual(attackerAuth.origin_ref, serviceAuth.origin_ref);
  assert.notEqual(attackerAuth.event_id, serviceAuth.event_id);
  assert.notEqual(attackerRead.request_ref, serviceRead.request_ref);
  assert.notEqual(attackerRead.event_id, serviceRead.event_id);

  const session = createOffenseSession(spec);
  const { estate } = session;
  const choice = inferRoute({
    routes: estate.routes,
    principals: estate.principals,
    deployments: estate.deployments,
    leases: estate.leases,
  });
  const snapshots = stepOffense(session, { tool: 'snapshots' }).snapshots;
  const events = stepOffense(session, { tool: 'snapshot-events' }).events;
  const mountRef = estate.routes.find((item) => item.id === choice.route).mount_ref;
  const snapshot = inferSnapshot({
    snapshots,
    events,
    credentialRef: session.initial.credential_ref,
    mountRef,
    deployment: choice.deployment,
    at: 1100,
  });
  const secret = stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot } }).secret;
  const denied = stepOffense(session, {
    tool: 'authenticate',
    args: { ...choice, secret, origin_ref: 'caller-supplied-origin' },
  });
  assert.equal(denied.allowed, true);
  assert.notEqual(session.auth.origin_ref, 'caller-supplied-origin');
});

test('producer owns every in-scope consumer binding and varies v1 dependency', () => {
  const counts = new Set();
  for (let seed = 64001; seed <= 64009; seed += 1) {
    const session = createOffenseSession({ ...spec, seed });
    const rotation = session.ledger.find((event) => event.type === 'rotation.started');
    const bindings = session.ledger.filter(
      (event) =>
        event.type === 'consumer.binding' && event.credential_ref === rotation.credential_ref,
    );
    assert.equal(bindings.length, 4);
    assert.equal(new Set(bindings.map((item) => item.consumer_ref)).size, 4);
    assert.deepEqual(
      new Set(bindings.map((item) => item.delivery)),
      new Set(['direct', 'cached', 'deployment']),
    );
    assert.ok(bindings.every((item) => ['v1', 'v2'].includes(item.current_version)));
    counts.add(bindings.filter((item) => item.current_version === 'v1').length);
  }
  assert.deepEqual(counts, new Set([2, 3, 4]));
});
