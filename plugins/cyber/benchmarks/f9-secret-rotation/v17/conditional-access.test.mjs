import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../v10/graph.mjs';
import * as offense from './offense.mjs';

const {
  createOffenseSession,
  inferGrant,
  inferReadVersion,
  referenceOffense,
  scoreOffense,
  stepOffense,
} = offense;
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });
const latest = (events, predicate, at) =>
  events
    .filter((event) => predicate(event) && event.event_time <= at)
    .sort((a, b) => b.event_time - a.event_time)[0];
const effective = (events, predicate, at) =>
  events
    .filter(
      (event) =>
        predicate(event) &&
        event.event_time <= at &&
        Number.isSafeInteger(event.effective_at) &&
        event.effective_at <= at,
    )
    .sort((a, b) => b.effective_at - a.effective_at || b.event_time - a.event_time)[0];

function eligibleRoutes(session) {
  const routes = act(session, 'routes').routes;
  const principals = act(session, 'principals').principals;
  const deployments = act(session, 'deployments').events;
  const leases = act(session, 'auth-leases').events;
  return routes.flatMap((route) => {
    const principal = principals.find((item) => item.service === route.service)?.principal;
    const deployment = latest(
      deployments,
      (item) =>
        item.service === route.service &&
        item.principal === principal &&
        item.mount_ref === route.mount_ref,
      1100,
    );
    const lease = latest(leases, (item) => item.mount_ref === route.mount_ref, 1100);
    return deployment?.key_version === 'v1' && lease?.status === 'active'
      ? [
          {
            route: route.id,
            principal,
            deployment: deployment.deployment,
            mount_ref: route.mount_ref,
          },
        ]
      : [];
  });
}

function liveSnapshot(session, route) {
  const snapshots = act(session, 'snapshots').snapshots;
  const statuses = act(session, 'snapshot-events').events;
  const candidates = snapshots.filter(
    (item) =>
      item.credential_ref === session.initial.credential_ref &&
      item.mount_ref === route.mount_ref &&
      item.deployment_ref === route.deployment &&
      item.key_version === 'v1' &&
      effective(statuses, (event) => event.snapshot_id === item.id, 1100)?.status === 'active',
  );
  assert.equal(candidates.length, 1);
  return { snapshot: candidates[0], statuses };
}

test('two old-credential routes authenticate but only one has the target entitlement', () => {
  for (let seed = 96001; seed <= 96006; seed += 1) {
    const spec = { seed, family: FAMILIES[(seed - 96001) % FAMILIES.length] };
    const inspect = createOffenseSession(spec);
    const routes = eligibleRoutes(inspect);
    assert.equal(routes.length, 2);
    const grants = [];
    for (const route of routes) {
      const session = createOffenseSession(spec);
      const { snapshot } = liveSnapshot(session, route);
      const secret = act(session, 'read-snapshot', { id: snapshot.id }).secret;
      const auth = act(session, 'authenticate', { ...route, secret });
      assert.equal(auth.allowed, true);
      const catalog = act(session, 'grants', { receipt: auth.receipt });
      const events = act(session, 'grant-events', { receipt: auth.receipt }).events;
      assert.ok(catalog.grants.every((grant) => grant.principal === route.principal));
      assert.ok(
        events.every((event) => catalog.grants.some((grant) => grant.id === event.grant_id)),
      );
      grants.push(inferGrant({ ...catalog, events }));
    }
    assert.equal(grants.filter(Boolean).length, 1);
  }
});

test('scheduled revocation and reactivation use effective time at each native decision', () => {
  const spec = { seed: 96007, family: 'cached-interval' };
  const session = createOffenseSession(spec);
  const routes = eligibleRoutes(session);
  assert.equal(routes.length, 2);
  const snapshots = act(session, 'snapshots').snapshots;
  const statuses = act(session, 'snapshot-events').events;
  assert.equal(statuses.length, 13);
  assert.ok(statuses.every((event) => Number.isSafeInteger(event.effective_at)));
  const live = liveSnapshot(session, routes[0]);
  assert.equal(
    latest(statuses, (item) => item.snapshot_id === live.snapshot.id, 1100).status,
    'revoked',
  );
  assert.equal(
    effective(statuses, (item) => item.snapshot_id === live.snapshot.id, 1100).status,
    'active',
  );
  const sameScope = snapshots.filter(
    (item) =>
      item.credential_ref === session.initial.credential_ref &&
      item.mount_ref === routes[0].mount_ref &&
      item.deployment_ref === routes[0].deployment &&
      item.key_version === 'v1',
  );
  if (sameScope.length > 1) {
    const stale = sameScope.find((item) => item.id !== live.snapshot.id);
    assert.equal(latest(statuses, (item) => item.snapshot_id === stale.id, 1100).status, 'active');
    assert.equal(
      effective(statuses, (item) => item.snapshot_id === stale.id, 1100).status,
      'revoked',
    );
  }
});

test('reference can switch after a valid but unentitled authentication', () => {
  let switched = false;
  for (let seed = 96001; seed <= 96012; seed += 1) {
    for (const family of FAMILIES) {
      const result = referenceOffense({ seed, family });
      assert.equal(result.score.success, true, `${seed}/${family}`);
      assert.ok(result.session.actionCount <= 25);
      switched ||=
        result.session.ledger.filter((event) => event.type === 'auth.receipt').length === 2;
    }
  }
  assert.equal(switched, true);
});

test('native score accepts a read causally linked to the second accepted receipt', () => {
  const spec = { seed: 96008, family: 'cached-interval' };
  const inspect = createOffenseSession(spec);
  const routes = eligibleRoutes(inspect);
  assert.equal(routes.length, 2);
  const outcomes = routes.map((route) => {
    const session = createOffenseSession(spec);
    const { snapshot } = liveSnapshot(session, route);
    const secret = act(session, 'read-snapshot', { id: snapshot.id }).secret;
    const auth = act(session, 'authenticate', { ...route, secret });
    const catalog = act(session, 'grants', { receipt: auth.receipt });
    const events = act(session, 'grant-events', { receipt: auth.receipt }).events;
    return { route, entitled: Boolean(inferGrant({ ...catalog, events })) };
  });
  const [wrong, right] = [
    outcomes.find((item) => !item.entitled),
    outcomes.find((item) => item.entitled),
  ];
  assert.ok(wrong && right);
  const session = createOffenseSession(spec);
  for (const { route } of [wrong, right]) {
    const { snapshot } = liveSnapshot(session, route);
    const secret = act(session, 'read-snapshot', { id: snapshot.id }).secret;
    const auth = act(session, 'authenticate', { ...route, secret });
    assert.equal(auth.allowed, true);
    const catalog = act(session, 'grants', { receipt: auth.receipt });
    const events = act(session, 'grant-events', { receipt: auth.receipt }).events;
    const grant = inferGrant({ ...catalog, events });
    if (grant) {
      const redeemed = act(session, 'redeem-grant', { receipt: auth.receipt, grant });
      const objects = act(session, 'object-versions', { token: redeemed.read_token });
      const access = act(session, 'access-policies', { token: redeemed.read_token });
      const version = inferReadVersion({
        ...objects,
        permits: access.permits,
        permitEvents: access.events,
      });
      const read = act(session, 'protected-read', { token: redeemed.read_token, version });
      assert.equal(read.allowed, true);
    }
  }
  assert.equal(session.ledger.filter((event) => event.type === 'auth.receipt').length, 2);
  assert.equal(scoreOffense(session).success, true);
});
