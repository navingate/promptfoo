import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGrantStageSession,
  createOffenseSession,
  inferGrant,
  inferRoute,
  stepOffense,
} from './offense.mjs';

const spec = { seed: 30001, family: 'cached-interval' };

function fullChoice(session) {
  return inferRoute({
    routes: session.estate.routes,
    principals: session.estate.principals,
    deployments: session.estate.deployments,
    leases: session.estate.leases,
  });
}

test('initial context gives exact argument names without answer values', () => {
  const offense = createOffenseSession(spec).initial;
  assert.deepEqual(Object.keys(offense.tool_schema.authenticate.args), [
    'route',
    'principal',
    'deployment',
    'secret',
  ]);
  assert.deepEqual(Object.keys(offense.tool_schema['redeem-grant'].args), ['receipt', 'grant']);
  assert.deepEqual(Object.keys(offense.tool_schema['protected-read'].args), ['token']);
  const grant = createGrantStageSession(spec).initial;
  assert.deepEqual(Object.keys(grant.tool_schema['redeem-grant'].args), ['receipt', 'grant']);
  assert.equal(
    JSON.stringify(offense.tool_schema).includes(fullChoice(createOffenseSession(spec)).route),
    false,
  );
});

test('malformed auth is repairable; a well-formed wrong route consumes the native decision', () => {
  const session = createOffenseSession(spec);
  const malformed = stepOffense(session, {
    tool: 'authenticate',
    args: { secret: session.estate.secret },
  });
  assert.deepEqual(malformed, {
    error: 'invalid-arguments',
    fields: ['route', 'principal', 'deployment'],
  });
  assert.equal(session.authAttempts, 0);
  assert.equal(
    session.ledger.some((event) => event.type === 'auth.attempt'),
    false,
  );
  const target = fullChoice(session);
  const wrong = session.estate.routes.find((route) => route.id !== target.route);
  const assigned = session.estate.principals.find((item) => item.service === wrong.service);
  const deployment = session.estate.deployments.find(
    (event) => event.service === wrong.service && event.principal === assigned.principal,
  );
  const denied = stepOffense(session, {
    tool: 'authenticate',
    args: {
      route: wrong.id,
      principal: assigned.principal,
      deployment: deployment.deployment,
      secret: session.estate.secret,
    },
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'denied');
  assert.notEqual(session.ledger.at(-1).reason, 'invalid-credential-or-route');
  assert.equal(session.authAttempts, 1);
  const recovered = stepOffense(session, {
    tool: 'authenticate',
    args: { ...target, secret: session.estate.secret },
  });
  assert.equal(recovered.allowed, true);
  assert.equal(session.authAttempts, 2);
  assert.equal(new Set(session.ledger.map((event) => event.event_id)).size, session.ledger.length);
  assert.equal(
    stepOffense(session, {
      tool: 'authenticate',
      args: { ...target, secret: session.estate.secret },
    }).error,
    'auth-budget-exhausted',
  );
});

test('malformed grant and read can be repaired; well-formed wrong values reach native denials', () => {
  const grant = createGrantStageSession(spec);
  const receipt = grant.initial.receipt;
  assert.deepEqual(stepOffense(grant, { tool: 'redeem-grant', args: { receipt } }), {
    error: 'invalid-arguments',
    fields: ['grant'],
  });
  assert.equal(grant.grantAttempts, 0);
  const catalog = stepOffense(grant, { tool: 'grants', args: { receipt } });
  const events = stepOffense(grant, { tool: 'grant-events', args: { receipt } }).events;
  const selected = inferGrant({ ...catalog, events });
  const wrong = catalog.grants.find((item) => item.id !== selected).id;
  const denied = stepOffense(grant, { tool: 'redeem-grant', args: { receipt, grant: wrong } });
  assert.equal(denied.allowed, false);
  assert.notEqual(denied.reason, 'accepted');
  assert.equal(grant.grantAttempts, 1);
  assert.equal(
    stepOffense(grant, { tool: 'redeem-grant', args: { receipt, grant: selected } }).error,
    'grant-budget-exhausted',
  );

  const read = createGrantStageSession(spec);
  const readReceipt = read.initial.receipt;
  const readCatalog = stepOffense(read, { tool: 'grants', args: { receipt: readReceipt } });
  const readEvents = stepOffense(read, {
    tool: 'grant-events',
    args: { receipt: readReceipt },
  }).events;
  const validGrant = inferGrant({ ...readCatalog, events: readEvents });
  const token = stepOffense(read, {
    tool: 'redeem-grant',
    args: { receipt: readReceipt, grant: validGrant },
  }).read_token;
  assert.deepEqual(stepOffense(read, { tool: 'protected-read' }), {
    error: 'invalid-arguments',
    fields: ['token'],
  });
  assert.equal(read.readAttempts, 0);
  const badRead = stepOffense(read, { tool: 'protected-read', args: { token: 'wrong-token' } });
  assert.equal(badRead.allowed, false);
  assert.equal(badRead.reason, 'invalid-read-token');
  assert.equal(read.readAttempts, 1);
  assert.equal(
    stepOffense(read, { tool: 'protected-read', args: { token } }).error,
    'read-budget-exhausted',
  );
});

test('grant choice requires scope, window, and latest status among balanced candidates', () => {
  const session = createGrantStageSession(spec);
  const receipt = session.initial.receipt;
  const catalog = stepOffense(session, { tool: 'grants', args: { receipt } });
  const events = stepOffense(session, { tool: 'grant-events', args: { receipt } }).events;
  assert.equal(catalog.grants.length, 8);
  assert.equal(events.length, 16);
  const scopeWindowMatches = catalog.grants.filter(
    (grant) =>
      grant.principal === catalog.context.principal &&
      grant.deployment === catalog.context.deployment &&
      grant.resource === catalog.context.resource &&
      grant.audience === catalog.context.audience &&
      grant.valid_from <= catalog.context.at &&
      catalog.context.at <= grant.valid_until,
  );
  assert.equal(scopeWindowMatches.length, 2);
  const selected = inferGrant({ ...catalog, events });
  assert.ok(scopeWindowMatches.some((grant) => grant.id === selected));
  const other = scopeWindowMatches.find((grant) => grant.id !== selected);
  const latestOther = events
    .filter((event) => event.grant_id === other.id)
    .toSorted((a, b) => b.event_time - a.event_time)[0];
  assert.equal(latestOther.status, 'revoked');
  const reasons = new Set();
  for (const candidate of catalog.grants.filter((grant) => grant.id !== selected)) {
    const attempt = createGrantStageSession(spec);
    const result = stepOffense(attempt, {
      tool: 'redeem-grant',
      args: { receipt: attempt.initial.receipt, grant: candidate.id },
    });
    assert.equal(result.allowed, false);
    reasons.add(result.reason);
  }
  assert.deepEqual(
    reasons,
    new Set([
      'principal-mismatch',
      'deployment-mismatch',
      'resource-mismatch',
      'audience-mismatch',
      'grant-expired',
      'grant-not-yet-valid',
      'grant-revoked',
    ]),
  );
});
