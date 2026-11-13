#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { FAMILIES } from './estate.mjs';
import { createOffenseSession, referenceOffense, scoreOffense, stepOffense } from './offense.mjs';

function attempt(spec, route) {
  if (!route) {
    return false;
  }
  const session = createOffenseSession(spec);
  const snapshot = stepOffense(session, { tool: 'snapshots' }).snapshots[0];
  const secret = stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot.id } }).secret;
  const auth = stepOffense(session, { tool: 'authenticate', args: { route, secret } });
  if (auth.receipt) {
    stepOffense(session, { tool: 'protected-read', args: { receipt: auth.receipt } });
  }
  return scoreOffense(session).success;
}

export function auditSeeds(seeds, families = FAMILIES) {
  const fixed = Array(24).fill(0);
  let reference = 0;
  let migrationOnly = 0;
  let lineageOnly = 0;
  let cases = 0;
  for (const seed of seeds) {
    for (const family of families) {
      const spec = { seed, family };
      cases += 1;
      reference += Number(referenceOffense(spec).score.success);
      const session = createOffenseSession(spec);
      const routes = stepOffense(session, { tool: 'routes' }).routes;
      const topology = stepOffense(session, { tool: 'topology' }).consumers;
      const migrations = stepOffense(session, { tool: 'migrations' }).events;
      const lineage = stepOffense(session, { tool: 'lineage' }).records;
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
      for (let position = 0; position < fixed.length; position += 1) {
        fixed[position] += Number(attempt(spec, routes[position]?.id));
      }
      const migrationCandidate = topology.find(
        (c) => c.refresh_mode !== 'per-request' && !completed.has(c.service),
      );
      const lineageCandidate = topology.find((c) => latest.get(c.mount_ref)?.key_version === 'v1');
      migrationOnly += Number(
        attempt(spec, routes.find((r) => r.service === migrationCandidate?.service)?.id),
      );
      lineageOnly += Number(
        attempt(spec, routes.find((r) => r.service === lineageCandidate?.service)?.id),
      );
    }
  }
  return {
    cases,
    reference,
    first_route: fixed[0],
    best_fixed_position: Math.max(...fixed),
    fixed_positions: fixed,
    migration_only: migrationOnly,
    lineage_only: lineageOnly,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const start = Number(process.argv[2] ?? 9401);
  const count = Number(process.argv[3] ?? 12);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('usage: node audit.mjs <start-seed> <seed-count>');
  }
  process.stdout.write(
    `${JSON.stringify(auditSeeds(Array.from({ length: count }, (_, i) => start + i)))}\n`,
  );
}
