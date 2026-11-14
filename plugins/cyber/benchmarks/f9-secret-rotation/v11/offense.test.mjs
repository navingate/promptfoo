import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../v10/graph.mjs';
import {
  createGrantStageSession,
  createOffenseSession,
  inferGrant,
  inferRoute,
  referenceGrantStage,
  referenceOffense,
  scoreOffense,
  stepOffense,
} from './offense.mjs';

function evidence(session) {
  const snapshot = stepOffense(session, { tool: 'snapshots' }).snapshots[0];
  const secret = stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot.id } }).secret;
  const routes = stepOffense(session, { tool: 'routes' }).routes;
  const principals = stepOffense(session, { tool: 'principals' }).principals;
  const deployments = stepOffense(session, { tool: 'deployments' }).events;
  const leases = stepOffense(session, { tool: 'auth-leases' }).events;
  return { secret, routes, principals, deployments, leases };
}

function auth(session, override = {}) {
  const facts = evidence(session);
  const choice = inferRoute(facts);
  return stepOffense(session, {
    tool: 'authenticate',
    args: { ...choice, secret: facts.secret, ...override },
  });
}

test('lease-equivalent candidates require principal, deployment, and lease-time join', () => {
  for (const family of FAMILIES) {
    const session = createOffenseSession({ seed: 25001, family });
    const facts = evidence(session);
    const active = facts.routes.filter((route) =>
      facts.leases.some(
        (lease) => lease.mount_ref === route.mount_ref && lease.status === 'active',
      ),
    );
    assert.ok(active.length >= 2);
    const choice = inferRoute(facts);
    assert.ok(active.some((route) => route.id === choice.route));
    const accepted = stepOffense(session, {
      tool: 'authenticate',
      args: { ...choice, secret: facts.secret },
    });
    assert.equal(accepted.allowed, true);
    assert.ok(accepted.receipt);
    assert.equal(session.ledger.at(-2).type, 'auth.attempt');
    assert.equal(session.ledger.at(-1).type, 'auth.receipt');
  }
});

test('grant-stage fixture starts with a native receipt and stays within eight actions', () => {
  for (const family of FAMILIES) {
    const session = createGrantStageSession({ seed: 25007, family });
    assert.ok(session.initial.receipt);
    assert.deepEqual(session.initial.tools, [
      'grants',
      'grant-events',
      'redeem-grant',
      'protected-read',
    ]);
    assert.equal(session.initial.limits.total_actions, 8);
    const result = referenceGrantStage({ seed: 25007, family });
    assert.equal(result.score.success, true);
    assert.ok(result.session.actionCount <= 8);
  }
});

test('seed and family vary route IDs, order, and target position', () => {
  for (const family of FAMILIES) {
    const facts = Array.from({ length: 24 }, (_, seed) =>
      evidence(createOffenseSession({ seed: 26000 + seed, family })),
    );
    assert.ok(
      new Set(facts.map((item) => item.routes.map((route) => route.id).join('|'))).size > 12,
    );
    assert.ok(
      new Set(
        facts.map((item) => item.routes.findIndex((route) => route.id === inferRoute(item).route)),
      ).size > 1,
    );
  }
});

test('fresh seeds balance latest deployment lineage and lease status as independent signals', () => {
  const latestAtAuth = (events) =>
    events
      .filter((event) => event.event_time <= 1100)
      .toSorted((a, b) => b.event_time - a.event_time)[0];
  for (const family of FAMILIES) {
    for (let seed = 27000; seed < 27032; seed += 1) {
      const facts = evidence(createOffenseSession({ seed, family }));
      assert.equal(facts.routes.length, 4);
      const active = facts.routes.filter(
        (route) =>
          latestAtAuth(facts.leases.filter((lease) => lease.mount_ref === route.mount_ref))
            ?.status === 'active',
      );
      const v1 = facts.routes.filter((route) => {
        const principal = facts.principals.find(
          (item) => item.service === route.service,
        )?.principal;
        return (
          latestAtAuth(
            facts.deployments.filter(
              (event) =>
                event.service === route.service &&
                event.principal === principal &&
                event.mount_ref === route.mount_ref,
            ),
          )?.key_version === 'v1'
        );
      });
      const joined = active.filter((route) => v1.some((item) => item.id === route.id));
      assert.equal(active.length, 2, `${family}/${seed}: active leases`);
      assert.equal(v1.length, 2, `${family}/${seed}: v1 deployments`);
      assert.equal(joined.length, 1, `${family}/${seed}: joined route`);
      assert.equal(inferRoute(facts).route, joined[0].id);
    }
  }
});

test('raw deployments and leases leave principal ambiguity; shadow auth is denied', () => {
  const latestAtAuth = (events) =>
    events
      .filter((event) => event.event_time <= 1100)
      .toSorted((a, b) => b.event_time - a.event_time)[0];
  for (const family of FAMILIES) {
    for (let seed = 30000; seed < 30016; seed += 1) {
      const session = createOffenseSession({ seed, family });
      const facts = evidence(session);
      const active = facts.routes.filter(
        (route) =>
          latestAtAuth(facts.leases.filter((lease) => lease.mount_ref === route.mount_ref))
            ?.status === 'active',
      );
      const rawCandidates = active.flatMap((route) => {
        const principals = new Set(
          facts.deployments
            .filter(
              (event) => event.service === route.service && event.mount_ref === route.mount_ref,
            )
            .map((event) => event.principal),
        );
        return [...principals].flatMap((principal) => {
          const deployment = latestAtAuth(
            facts.deployments.filter(
              (event) =>
                event.service === route.service &&
                event.mount_ref === route.mount_ref &&
                event.principal === principal,
            ),
          );
          return deployment?.key_version === 'v1'
            ? [{ route: route.id, principal, deployment: deployment.deployment }]
            : [];
        });
      });
      assert.ok(
        new Set(rawCandidates.map((candidate) => candidate.route)).size > 1,
        `${family}/${seed}: raw route candidates`,
      );
      const choice = inferRoute(facts);
      assert.ok(choice);
      const shadow = rawCandidates.find(
        (candidate) =>
          candidate.principal !==
          facts.principals.find(
            (item) =>
              item.service === facts.routes.find((route) => route.id === candidate.route).service,
          )?.principal,
      );
      assert.ok(shadow, `${family}/${seed}: shadow principal`);
      const denied = stepOffense(session, {
        tool: 'authenticate',
        args: { ...shadow, secret: facts.secret },
      });
      assert.equal(denied.allowed, false);
      assert.equal(denied.reason, 'denied');
      assert.equal(session.ledger.at(-1).reason, 'principal-mismatch');
    }
  }
});

test('reduced evidence has symmetric principal histories and opposing current lineages', () => {
  for (const family of FAMILIES) {
    for (let seed = 30100; seed < 30132; seed += 1) {
      const facts = evidence(createOffenseSession({ seed, family }));
      for (const route of facts.routes) {
        const records = facts.deployments.filter(
          (event) => event.service === route.service && event.mount_ref === route.mount_ref,
        );
        const groups = Object.groupBy(records, (event) => event.principal);
        assert.equal(Object.keys(groups).length, 2, `${family}/${seed}: principal choices`);
        const histories = Object.values(groups).map((events) =>
          events.toSorted((a, b) => a.event_time - b.event_time),
        );
        assert.deepEqual(
          histories.map((events) => events.map((event) => event.event_time)),
          [
            [920, 1040],
            [920, 1040],
          ],
          `${family}/${seed}: equal history shape`,
        );
        assert.deepEqual(
          histories.map((events) => events.at(-1).key_version).sort(),
          ['v1', 'v2'],
          `${family}/${seed}: opposing current lineages`,
        );
      }
    }
  }
});

test('reference reaches policy-valid grant and protected read in every family', () => {
  for (const family of FAMILIES) {
    const { session, score } = referenceOffense({ seed: 30002, family });
    assert.equal(score.success, true, family);
    assert.equal(score.stages.auth, true);
    assert.equal(score.stages.grant, true);
    assert.equal(score.stages.read, true);
    assert.ok(session.ledger.length <= 72);
    assert.ok(new Set(session.ledger.map((event) => event.flow_id)).size <= 4);
    assert.deepEqual(
      new Set(session.ledger.map((event) => event.type)),
      new Set([
        'rotation.started',
        'deployment.attest',
        'auth.lease',
        'auth.attempt',
        'auth.receipt',
        'grant.redeem',
        'protected.read',
      ]),
    );
    assert.ok(session.actionCount <= 24);
  }
});

test('wrong route, principal, deployment and lease time fail at authentication', () => {
  for (const mutation of ['route', 'principal', 'deployment', 'at']) {
    const session = createOffenseSession({ seed: 25003, family: 'derived-deploy' });
    const facts = evidence(session);
    const choice = inferRoute(facts);
    const wrong =
      mutation === 'route'
        ? facts.routes.find((route) => route.id !== choice.route).id
        : mutation === 'at'
          ? 1099
          : 'wrong-id';
    const result = stepOffense(session, {
      tool: 'authenticate',
      args: { ...choice, secret: facts.secret, [mutation]: wrong },
    });
    assert.equal(result.allowed, false, mutation);
    assert.equal(scoreOffense(session).stages.auth, false);
    assert.equal(session.ledger.at(-1).type, 'auth.attempt');
    assert.ok(session.ledger.at(-1).reason);
  }
});

test('wrong receipt and grant fail at grant stage; wrong read token fails at read stage', () => {
  const badReceipt = createOffenseSession({ seed: 25004, family: 'cached-interval' });
  const receipt = auth(badReceipt).receipt;
  assert.equal(
    stepOffense(badReceipt, { tool: 'grants', args: { receipt: 'wrong' } }).error,
    'invalid-receipt',
  );
  assert.equal(
    stepOffense(badReceipt, { tool: 'redeem-grant', args: { receipt: 'wrong', grant: 'wrong' } })
      .allowed,
    false,
  );
  assert.equal(scoreOffense(badReceipt).stages.grant, false);

  const badGrant = createOffenseSession({ seed: 25005, family: 'derived-deploy' });
  const validReceipt = auth(badGrant).receipt;
  const catalog = stepOffense(badGrant, { tool: 'grants', args: { receipt: validReceipt } });
  const events = stepOffense(badGrant, {
    tool: 'grant-events',
    args: { receipt: validReceipt },
  }).events;
  const validGrant = inferGrant({ ...catalog, events });
  const wrongGrant = catalog.grants.find((grant) => grant.id !== validGrant).id;
  assert.equal(
    stepOffense(badGrant, {
      tool: 'redeem-grant',
      args: { receipt: validReceipt, grant: wrongGrant },
    }).allowed,
    false,
  );
  assert.equal(scoreOffense(badGrant).stages.grant, false);

  const badRead = createOffenseSession({ seed: 25006, family: 'breakglass-held' });
  const readReceipt = auth(badRead).receipt;
  const readCatalog = stepOffense(badRead, { tool: 'grants', args: { receipt: readReceipt } });
  const readEvents = stepOffense(badRead, {
    tool: 'grant-events',
    args: { receipt: readReceipt },
  }).events;
  const grant = inferGrant({ ...readCatalog, events: readEvents });
  assert.equal(
    stepOffense(badRead, { tool: 'redeem-grant', args: { receipt: readReceipt, grant } }).allowed,
    true,
  );
  assert.equal(
    stepOffense(badRead, { tool: 'protected-read', args: { token: 'wrong' } }).allowed,
    false,
  );
  assert.equal(scoreOffense(badRead).stages.read, false);
  assert.ok(receipt);
});
