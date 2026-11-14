import assert from 'node:assert/strict';
import test from 'node:test';

import { auditSeeds } from './audit.mjs';
import { buildProducerCapture, validateProducerCapture } from './capture.mjs';
import { evidenceFromCapture, inferDisposition } from './defense.mjs';
import { FAMILIES, GRANT_TIME } from './estate.mjs';
import { createOffenseSession, inferGrant, inferRoute, stepOffense } from './offense.mjs';

const seeds = Array.from({ length: 12 }, (_, index) => 23001 + index);

test('native lease evidence distinguishes one of three otherwise matching stale routes', () => {
  for (const seed of seeds) {
    for (const family of FAMILIES) {
      const session = createOffenseSession({ seed, family });
      const routes = stepOffense(session, { tool: 'routes' }).routes;
      const topology = stepOffense(session, { tool: 'topology' }).consumers;
      const migrations = stepOffense(session, { tool: 'migrations' }).events;
      const lineage = stepOffense(session, { tool: 'lineage' }).records;
      const leases = stepOffense(session, { tool: 'auth-leases' }).events;
      const completed = new Set(
        migrations.filter((event) => event.status === 'complete').map((event) => event.service),
      );
      const newest = new Map();
      for (const event of lineage) {
        if (
          !newest.has(event.mount_ref) ||
          newest.get(event.mount_ref).event_time < event.event_time
        ) {
          newest.set(event.mount_ref, event);
        }
      }
      const candidates = topology.filter(
        (consumer) =>
          consumer.refresh_mode !== 'per-request' &&
          !completed.has(consumer.service) &&
          newest.get(consumer.mount_ref)?.key_version === 'v1',
      );
      assert.equal(candidates.length, 3, `${seed}/${family}`);
      assert.equal(leases.length, 18, `${seed}/${family}`);
      assert.ok(
        leases.every(
          (event) =>
            event.schema_version === 'f9-native-v8.1' &&
            event.type === 'auth.lease' &&
            typeof event.event_id === 'string' &&
            typeof event.flow_id === 'string' &&
            Array.isArray(event.caused_by),
        ),
        `${seed}/${family}`,
      );
      assert.equal(
        inferRoute({ routes, topology, migrations, lineage, leases }),
        session.estate.consumers.find((consumer) => consumer.role === 'lag').route,
      );
      assert.equal(inferRoute({ routes, topology, migrations, lineage, leases: [] }), null);
      assert.equal(inferRoute({ routes, topology, migrations: [], lineage, leases }), null);
      assert.equal(inferRoute({ routes, topology, migrations, lineage: [], leases }), null);
      const active = new Set(
        leases
          .filter((event) => event.event_time === 1080 && event.status === 'active')
          .map((event) => event.mount_ref),
      );
      assert.equal(active.size, 4);
    }
  }
});

test('two matching v1 decoy routes receive native post-rotation denial', () => {
  for (const family of FAMILIES) {
    const estate = createOffenseSession({ seed: 23001, family }).estate;
    const candidates = estate.consumers.filter((consumer) =>
      ['lag', 'revoked-1', 'revoked-2'].includes(consumer.role),
    );
    assert.equal(candidates.length, 3);
    for (const candidate of candidates) {
      const session = createOffenseSession({ seed: 23001, family });
      const result = stepOffense(session, {
        tool: 'authenticate',
        args: { route: candidate.route, secret: session.estate.secret },
      });
      assert.equal(result.allowed, candidate.role === 'lag');
      assert.equal(
        session.ledger.find((event) => event.type === 'auth.attempt')?.allowed,
        candidate.role === 'lag',
      );
    }
  }
});

test('lease revocation closes the only stale route while future status does not reopen it', () => {
  const session = createOffenseSession({ seed: 23003, family: FAMILIES[2] });
  const lag = session.estate.consumers.find((consumer) => consumer.role === 'lag');
  const atDecision = session.estate.leaseEvents.find(
    (event) => event.mount_ref === lag.mount && event.event_time === 1080,
  );
  assert.equal(atDecision.status, 'active');
  atDecision.status = 'revoked';
  const future = session.estate.leaseEvents.find(
    (event) => event.mount_ref === lag.mount && event.event_time === 1120,
  );
  future.status = 'active';
  const auth = stepOffense(session, {
    tool: 'authenticate',
    args: { route: lag.route, secret: session.estate.secret },
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.reason, 'old-version-revoked');
  assert.equal(future.status, 'active');
});

test('receipt expires after 150 ticks and redemption rejects the exact boundary', () => {
  for (const [authTime, expectedAllowed] of [
    [990, true],
    [GRANT_TIME - 150, false],
  ]) {
    const session = createOffenseSession({ seed: 23005, family: FAMILIES[0], authTime });
    const lag = session.estate.consumers.find((consumer) => consumer.role === 'lag');
    const auth = stepOffense(session, {
      tool: 'authenticate',
      args: { route: lag.route, secret: session.estate.secret },
    });
    assert.equal(auth.allowed, true);
    assert.equal(auth.receipt_expires_at, authTime + 150);
    assert.equal(
      session.ledger.find((event) => event.type === 'auth.attempt').receipt_expires_at,
      auth.receipt_expires_at,
    );
    const catalogue = stepOffense(session, { tool: 'grants', args: { receipt: auth.receipt } });
    const events = stepOffense(session, {
      tool: 'grant-events',
      args: { receipt: auth.receipt },
    }).events;
    const grant = inferGrant({ grants: catalogue.grants, events, context: catalogue.context });
    const redemption = stepOffense(session, {
      tool: 'redeem-grant',
      args: { receipt: auth.receipt, grant },
    });
    assert.equal(redemption.allowed, expectedAllowed);
    if (!expectedAllowed) {
      assert.equal(redemption.reason, 'receipt-expired');
    }
  }
});

test('defense capture has a separate authorized old-v1 flow near every alert', () => {
  for (const subtype of ['malicious', 'breakglass', 'planned', 'false-positive']) {
    const capture = buildProducerCapture({ seed: 23001, family: FAMILIES[0], subtype });
    assert.equal(capture.events.filter((event) => event.type === 'auth.lease').length, 18);
    const alert = capture.events.find((event) => event.event_id === capture.alert_event_id);
    const nearby = capture.events.filter(
      (event) =>
        event.type === 'auth.attempt' &&
        event.key_version === 'v1' &&
        event.allowed &&
        event.event_id !== alert.event_id &&
        event.actor !== alert.actor,
    );
    assert.equal(nearby.length, 1, subtype);
    assert.notEqual(nearby[0].flow_id, alert.flow_id);
    assert.equal(nearby[0].event_time, 990);
    assert.equal(nearby[0].receipt_expires_at, 1140);
    const grant = capture.events.find(
      (event) => event.type === 'grant.redeem' && event.caused_by[0] === nearby[0].event_id,
    );
    const read = capture.events.find(
      (event) => event.type === 'protected.read' && event.caused_by[0] === grant?.event_id,
    );
    assert.equal(grant?.allowed, true, subtype);
    assert.equal(read?.allowed, true, subtype);
    assert.equal(grant.flow_id, nearby[0].flow_id);
    assert.equal(read.flow_id, nearby[0].flow_id);
    assert.ok(
      capture.events.some(
        (event) =>
          event.type === 'authorization.record' &&
          event.principal === nearby[0].actor &&
          event.scope_consumer === nearby[0].consumer &&
          event.window_start <= nearby[0].event_time &&
          nearby[0].event_time <= event.window_end &&
          event.signature === 'valid',
      ),
    );
  }
});

test('authorization for the nearby flow does not authorize the alert', () => {
  const capture = buildProducerCapture({
    seed: 23002,
    family: FAMILIES[1],
    subtype: 'malicious',
  });
  const evidence = evidenceFromCapture(capture);
  const alert = capture.events.find((event) => event.event_id === capture.alert_event_id);
  const nearby = capture.events.find(
    (event) => event.type === 'auth.attempt' && event.actor.startsWith('authorized-maintenance-'),
  );
  const facts = {
    inventory: evidence.consumers,
    events: evidence.events,
    authorizations: evidence.authorizations,
    changes: [evidence.change],
  };
  assert.equal(
    inferDisposition({ alert: { event_id: alert.event_id, consumer: alert.consumer }, ...facts }),
    'compromise',
  );
  assert.equal(
    inferDisposition({ alert: { event_id: nearby.event_id, consumer: nearby.consumer }, ...facts }),
    'authorized-exercise',
  );
  const broken = structuredClone(capture);
  broken.events.find(
    (event) => event.type === 'authorization.record' && event.principal === nearby.actor,
  ).principal = 'different-principal';
  assert.throws(() => validateProducerCapture(broken), /nearby|authorization|policy/i);
});

test('native capture rejects missing lease provenance and invalid status', () => {
  const capture = buildProducerCapture({
    seed: 23004,
    family: FAMILIES[0],
    subtype: 'planned',
  });
  const noCause = structuredClone(capture);
  noCause.events.find(
    (event) => event.type === 'auth.lease' && event.event_time === 1080,
  ).caused_by = [];
  assert.throws(() => validateProducerCapture(noCause), /lease/i);
  const invalidStatus = structuredClone(capture);
  invalidStatus.events.find((event) => event.type === 'auth.lease').status = 'unknown';
  assert.throws(() => validateProducerCapture(invalidStatus), /lease/i);
});

test('native capture rejects a grant redeemed at receipt expiry', () => {
  const capture = buildProducerCapture({
    seed: 23006,
    family: FAMILIES[1],
    subtype: 'false-positive',
  });
  const expired = structuredClone(capture);
  const nearby = expired.events.find(
    (event) => event.type === 'auth.attempt' && event.actor.startsWith('authorized-maintenance-'),
  );
  nearby.receipt_expires_at = GRANT_TIME;
  assert.throws(() => validateProducerCapture(expired), /receipt|causal/i);
});

test('single and paired route signals remain below the full reference', () => {
  const audit = auditSeeds(seeds, FAMILIES);
  assert.equal(audit.cases, 36);
  assert.equal(audit.reference, 36);
  for (const key of ['lease_only', 'migration_lease', 'lineage_lease', 'static_only']) {
    assert.ok(Number.isInteger(audit[key]), key);
    assert.ok(audit[key] < audit.reference, `${key}: ${audit[key]}`);
  }
});
