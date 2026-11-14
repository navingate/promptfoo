#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { AUTH_TIME, FAMILIES, latestLeaseStatus } from './estate.mjs';
import {
  createGrantStageSession,
  createOffenseSession,
  inferGrant,
  referenceGrantStage,
  referenceOffense,
  scoreOffense,
  stepOffense,
} from './offense.mjs';

function latestStatus(events, id, at) {
  return (
    events
      .filter((event) => event.grant_id === id && event.event_time <= at)
      .sort((a, b) => b.event_time - a.event_time)[0]?.status ?? null
  );
}

function finishFromGrant(session, receipt, selectGrant) {
  const catalog = stepOffense(session, { tool: 'grants', args: { receipt } });
  const events = stepOffense(session, { tool: 'grant-events', args: { receipt } }).events;
  const grant = selectGrant(catalog, events);
  if (!grant) {
    return false;
  }
  const redeemed = stepOffense(session, { tool: 'redeem-grant', args: { receipt, grant } });
  if (redeemed.read_token) {
    stepOffense(session, { tool: 'protected-read', args: { token: redeemed.read_token } });
  }
  return scoreOffense(session).success;
}

const perfectGrant = (catalog, events) =>
  inferGrant({
    grants: catalog.grants,
    events,
    context: catalog.context,
  });

function attemptRoute(spec, route, selectGrant = perfectGrant) {
  if (!route) {
    return false;
  }
  const session = createOffenseSession(spec);
  const snapshot = stepOffense(session, { tool: 'snapshots' }).snapshots[0];
  const secret = stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot.id } }).secret;
  const auth = stepOffense(session, { tool: 'authenticate', args: { route, secret } });
  return auth.receipt ? finishFromGrant(session, auth.receipt, selectGrant) : false;
}

function attemptGrantStage(spec, selectGrant) {
  const session = createGrantStageSession(spec);
  return finishFromGrant(session, session.initial.receipt, selectGrant);
}

export function auditSeeds(seeds, families = FAMILIES) {
  const fixedRoute = Array(24).fill(0);
  const fixedGrant = Array(16).fill(0);
  const counts = {
    cases: 0,
    reference: 0,
    grant_reference: 0,
    migration_only: 0,
    lineage_only: 0,
    lease_only: 0,
    migration_lease: 0,
    lineage_lease: 0,
    static_only: 0,
    grant_scope_only: 0,
    grant_audience_only: 0,
    grant_lineage_only: 0,
    grant_status_only: 0,
    grant_catalog_only: 0,
    first_route_first_grant: 0,
  };
  for (const seed of seeds) {
    for (const family of families) {
      const spec = { seed, family };
      counts.cases += 1;
      counts.reference += Number(referenceOffense(spec).score.success);
      counts.grant_reference += Number(referenceGrantStage(spec).score.success);
      const session = createOffenseSession(spec);
      const routes = stepOffense(session, { tool: 'routes' }).routes;
      const topology = stepOffense(session, { tool: 'topology' }).consumers;
      const migrations = stepOffense(session, { tool: 'migrations' }).events;
      const lineage = stepOffense(session, { tool: 'lineage' }).records;
      const leases = stepOffense(session, { tool: 'auth-leases' }).events;
      const completed = new Set(
        migrations.filter((event) => event.status === 'complete').map((event) => event.service),
      );
      const latest = new Map();
      for (const record of lineage) {
        const previous = latest.get(record.mount_ref);
        if (!previous || record.event_time > previous.event_time) {
          latest.set(record.mount_ref, record);
        }
      }
      for (let position = 0; position < fixedRoute.length; position += 1) {
        fixedRoute[position] += Number(attemptRoute(spec, routes[position]?.id));
      }
      counts.first_route_first_grant += Number(
        attemptRoute(spec, routes[0]?.id, (catalog) => catalog.grants[0]?.id),
      );
      const migrationCandidate = topology.find(
        (c) => c.refresh_mode !== 'per-request' && !completed.has(c.service),
      );
      const lineageCandidate = topology.find((c) => latest.get(c.mount_ref)?.key_version === 'v1');
      const activeLease = (c) => latestLeaseStatus(leases, c.mount_ref, AUTH_TIME) === 'active';
      const leaseCandidate = topology.find(activeLease);
      const migrationLeaseCandidate = topology.find(
        (c) => !completed.has(c.service) && activeLease(c),
      );
      const lineageLeaseCandidate = topology.find(
        (c) => latest.get(c.mount_ref)?.key_version === 'v1' && activeLease(c),
      );
      const staticCandidate = topology.find(
        (c) => !completed.has(c.service) && latest.get(c.mount_ref)?.key_version === 'v1',
      );
      counts.migration_only += Number(
        attemptRoute(spec, routes.find((r) => r.service === migrationCandidate?.service)?.id),
      );
      counts.lineage_only += Number(
        attemptRoute(spec, routes.find((r) => r.service === lineageCandidate?.service)?.id),
      );
      for (const [key, candidate] of [
        ['lease_only', leaseCandidate],
        ['migration_lease', migrationLeaseCandidate],
        ['lineage_lease', lineageLeaseCandidate],
        ['static_only', staticCandidate],
      ]) {
        counts[key] += Number(
          attemptRoute(spec, routes.find((r) => r.service === candidate?.service)?.id),
        );
      }
      for (let position = 0; position < fixedGrant.length; position += 1) {
        fixedGrant[position] += Number(
          attemptGrantStage(spec, (catalog) => catalog.grants[position]?.id),
        );
      }
      counts.grant_scope_only += Number(
        attemptGrantStage(
          spec,
          (catalog) =>
            catalog.grants.find(
              (grant) => grant.resource_scope === catalog.context.protected_resource,
            )?.id,
        ),
      );
      counts.grant_audience_only += Number(
        attemptGrantStage(
          spec,
          (catalog) =>
            catalog.grants.find((grant) => grant.audience === catalog.context.audience)?.id,
        ),
      );
      counts.grant_lineage_only += Number(
        attemptGrantStage(
          spec,
          (catalog) =>
            catalog.grants.find(
              (grant) => grant.credential_lineage === catalog.context.credential_lineage,
            )?.id,
        ),
      );
      counts.grant_status_only += Number(
        attemptGrantStage(
          spec,
          (catalog, events) =>
            catalog.grants.find(
              (grant) => latestStatus(events, grant.id, catalog.context.at) === 'active',
            )?.id,
        ),
      );
      counts.grant_catalog_only += Number(
        attemptGrantStage(
          spec,
          (catalog) =>
            catalog.grants.find(
              (grant) =>
                grant.consumer === catalog.context.consumer &&
                grant.credential_lineage === catalog.context.credential_lineage &&
                grant.resource_scope === catalog.context.protected_resource &&
                grant.audience === catalog.context.audience &&
                grant.valid_from <= catalog.context.at &&
                catalog.context.at <= grant.valid_until,
            )?.id,
        ),
      );
    }
  }
  return {
    ...counts,
    first_route: fixedRoute[0],
    best_fixed_position: Math.max(...fixedRoute),
    fixed_positions: fixedRoute,
    grant_first_position: fixedGrant[0],
    grant_best_fixed_position: Math.max(...fixedGrant),
    grant_fixed_positions: fixedGrant,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const start = Number(process.argv[2] ?? 9601);
  const count = Number(process.argv[3] ?? 12);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('usage: node audit.mjs <start-seed> <seed-count>');
  }
  process.stdout.write(
    `${JSON.stringify(auditSeeds(Array.from({ length: count }, (_, i) => start + i)))}\n`,
  );
}
