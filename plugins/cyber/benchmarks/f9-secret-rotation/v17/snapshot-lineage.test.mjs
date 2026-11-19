import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../v10/graph.mjs';
import { createOffenseSession, inferRoute, referenceOffense, stepOffense } from './offense.mjs';

const spec = { seed: 79001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });
const latest = (events, snapshotId) =>
  events
    .filter(
      (event) =>
        event.snapshot_id === snapshotId && event.event_time <= 1100 && event.effective_at <= 1100,
    )
    .sort((a, b) => b.effective_at - a.effective_at || b.event_time - a.event_time)[0];

function visibleRoute(session) {
  return inferRoute({
    routes: act(session, 'routes').routes,
    principals: act(session, 'principals').principals,
    deployments: act(session, 'deployments').events,
    leases: act(session, 'auth-leases').events,
  });
}

test('snapshot catalog and status history expose one live v1 candidate per eligible route', () => {
  const session = createOffenseSession(spec);
  const route = visibleRoute(session);
  const catalog = act(session, 'snapshots').snapshots;
  const statuses = act(session, 'snapshot-events').events;
  const routeRecord = act(session, 'routes').routes.find((item) => item.id === route.route);
  assert.equal(catalog.length, 6);
  assert.equal(statuses.length, 13);
  assert.equal(new Set(catalog.map((item) => item.id)).size, 6);
  assert.equal(JSON.stringify(catalog).includes('secret:'), false);
  const candidates = catalog.filter(
    (item) =>
      item.credential_ref === session.initial.credential_ref &&
      item.mount_ref === routeRecord.mount_ref &&
      item.deployment_ref === route.deployment &&
      item.key_version === 'v1' &&
      latest(statuses, item.id)?.status === 'active',
  );
  assert.equal(candidates.length, 1);
  assert.equal(session.ledger.filter((event) => event.type === 'secret.snapshot').length, 6);
  assert.equal(session.ledger.filter((event) => event.type === 'secret.status').length, 13);
  assert.doesNotMatch(JSON.stringify(session.ledger), /v1-[a-f0-9]{24}/);
});

test('native authentication rejects each plausible but invalid snapshot', () => {
  const seed = 79002;
  const inspect = createOffenseSession({ ...spec, seed });
  const route = visibleRoute(inspect);
  const routeRecord = act(inspect, 'routes').routes.find((item) => item.id === route.route);
  const catalog = act(inspect, 'snapshots').snapshots;
  const statuses = act(inspect, 'snapshot-events').events;
  const target = catalog.filter(
    (item) =>
      item.credential_ref === inspect.initial.credential_ref &&
      item.mount_ref === routeRecord.mount_ref &&
      item.deployment_ref === route.deployment &&
      item.key_version === 'v1' &&
      latest(statuses, item.id)?.status === 'active',
  );
  assert.equal(target.length, 1);
  for (const candidate of catalog) {
    const session = createOffenseSession({ ...spec, seed });
    const { secret } = act(session, 'read-snapshot', { id: candidate.id });
    const auth = act(session, 'authenticate', { ...route, secret });
    assert.equal(auth.allowed, candidate.id === target[0].id, candidate.id);
    if (auth.allowed) {
      const native = session.ledger.find((event) => event.type === 'auth.attempt' && event.allowed);
      assert.ok(native.caused_by.includes(latest(statuses, candidate.id).event_id));
      assert.equal(native.snapshot_ref, candidate.id);
    }
  }
});

test('visible reference solves the full native chain across families', () => {
  for (const family of FAMILIES) {
    const result = referenceOffense({ ...spec, family });
    assert.equal(result.score.success, true);
    assert.ok(result.session.actionCount <= 25);
    assert.ok(
      [1, 2].includes(
        result.session.ledger.filter((event) => event.type === 'auth.attempt').length,
      ),
    );
  }
});
