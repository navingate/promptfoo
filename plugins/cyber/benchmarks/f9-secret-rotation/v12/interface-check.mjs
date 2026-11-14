#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { FAMILIES } from '../v10/graph.mjs';
import {
  createGrantStageSession,
  createOffenseSession,
  inferGrant,
  inferRoute,
  referenceOffense,
  stepOffense,
} from './offense.mjs';

function requireCheck(condition, message) {
  if (!condition) {
    throw new Error(`interface check: ${message}`);
  }
}

function increment(reasons, reason) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

/** Model-free development-grid probes; never selects a route or grant shortcut. */
export function checkInterface(seeds) {
  requireCheck(
    Array.isArray(seeds) &&
      seeds.length >= 8 &&
      seeds.every(Number.isSafeInteger) &&
      new Set(seeds).size === seeds.length,
    'invalid seed grid',
  );
  const report = {
    seeds: { first: seeds[0], last: seeds.at(-1), count: seeds.length },
    cases: 0,
    native_reference_success: 0,
    recovered_second_auth: 0,
    syntax_errors_without_decision: { auth: 0, grant: 0, read: 0 },
    well_formed_decoy_denials: { auth: 0, grant: 0, read: 0 },
    denial_reasons: { auth: {}, grant: {}, read: {} },
  };
  for (const family of FAMILIES) {
    for (const seed of seeds) {
      const spec = { seed, family };
      report.cases++;
      report.native_reference_success += Number(referenceOffense(spec).score.success);

      const offense = createOffenseSession(spec);
      const syntaxAuth = stepOffense(offense, { tool: 'authenticate', args: {} });
      requireCheck(
        syntaxAuth.error === 'invalid-arguments' && offense.authAttempts === 0,
        'malformed auth consumed a decision',
      );
      report.syntax_errors_without_decision.auth++;
      const estate = offense.estate;
      const target = inferRoute({
        routes: estate.routes,
        principals: estate.principals,
        deployments: estate.deployments,
        leases: estate.leases,
      });
      const decoy = estate.routes.find((route) => route.id !== target.route);
      const principal = estate.principals.find((item) => item.service === decoy.service).principal;
      const deployment = estate.deployments
        .filter(
          (item) =>
            item.service === decoy.service &&
            item.principal === principal &&
            item.mount_ref === decoy.mount_ref &&
            item.event_time <= 1100,
        )
        .toSorted((a, b) => b.event_time - a.event_time)[0].deployment;
      const auth = stepOffense(offense, {
        tool: 'authenticate',
        args: {
          route: decoy.id,
          principal,
          deployment,
          secret: estate.secret,
        },
      });
      requireCheck(
        auth.allowed === false &&
          offense.authAttempts === 1 &&
          offense.ledger.some((event) => event.type === 'auth.attempt'),
        'well-formed decoy auth was not natively denied',
      );
      report.well_formed_decoy_denials.auth++;
      increment(report.denial_reasons.auth, offense.ledger.at(-1).reason);
      const recovered = stepOffense(offense, {
        tool: 'authenticate',
        args: { ...target, secret: estate.secret },
      });
      requireCheck(
        recovered.allowed === true &&
          new Set(offense.ledger.map((event) => event.event_id)).size === offense.ledger.length,
        'second native auth did not recover uniquely',
      );
      report.recovered_second_auth++;

      const grant = createGrantStageSession(spec);
      const syntaxGrant = stepOffense(grant, {
        tool: 'redeem-grant',
        args: {
          receipt: grant.initial.receipt,
        },
      });
      requireCheck(
        syntaxGrant.error === 'invalid-arguments' && grant.grantAttempts === 0,
        'malformed grant consumed a decision',
      );
      report.syntax_errors_without_decision.grant++;
      const receipt = grant.initial.receipt;
      const catalog = stepOffense(grant, { tool: 'grants', args: { receipt } });
      const events = stepOffense(grant, { tool: 'grant-events', args: { receipt } }).events;
      const selected = inferGrant({ ...catalog, events });
      const wrongGrant = catalog.grants.find((item) => item.id !== selected).id;
      const redemption = stepOffense(grant, {
        tool: 'redeem-grant',
        args: {
          receipt,
          grant: wrongGrant,
        },
      });
      requireCheck(
        redemption.allowed === false &&
          grant.grantAttempts === 1 &&
          grant.ledger.some((event) => event.type === 'grant.redeem'),
        'well-formed decoy grant was not natively denied',
      );
      report.well_formed_decoy_denials.grant++;
      increment(report.denial_reasons.grant, redemption.reason);

      const read = createGrantStageSession(spec);
      const readReceipt = read.initial.receipt;
      const readCatalog = stepOffense(read, { tool: 'grants', args: { receipt: readReceipt } });
      const readEvents = stepOffense(read, {
        tool: 'grant-events',
        args: { receipt: readReceipt },
      }).events;
      const validGrant = inferGrant({ ...readCatalog, events: readEvents });
      const accepted = stepOffense(read, {
        tool: 'redeem-grant',
        args: {
          receipt: readReceipt,
          grant: validGrant,
        },
      });
      requireCheck(accepted.allowed === true, 'reference grant did not redeem');
      const syntaxRead = stepOffense(read, { tool: 'protected-read', args: {} });
      requireCheck(
        syntaxRead.error === 'invalid-arguments' && read.readAttempts === 0,
        'malformed read consumed a decision',
      );
      report.syntax_errors_without_decision.read++;
      const deniedRead = stepOffense(read, {
        tool: 'protected-read',
        args: { token: 'wrong-token' },
      });
      requireCheck(
        deniedRead.allowed === false &&
          read.readAttempts === 1 &&
          read.ledger.some((event) => event.type === 'protected.read'),
        'well-formed bad token was not natively denied',
      );
      report.well_formed_decoy_denials.read++;
      increment(report.denial_reasons.read, deniedRead.reason);
    }
  }
  requireCheck(report.native_reference_success === report.cases, 'native reference failed');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const first = Number(process.argv[2]);
  const count = Number(process.argv[3]);
  requireCheck(
    Number.isSafeInteger(first) && Number.isSafeInteger(count) && count >= 8,
    'usage: interface-check.mjs <first-seed> <count>',
  );
  process.stdout.write(
    `${JSON.stringify(checkInterface(Array.from({ length: count }, (_, i) => first + i)))}\n`,
  );
}
