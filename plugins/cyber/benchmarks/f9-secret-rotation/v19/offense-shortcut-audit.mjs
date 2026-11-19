#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { FAMILIES } from '../v10/graph.mjs';
import { createOffenseSession, scoreOffense, stepOffense } from './offense.mjs';

const AUTH_TIME = 1100;
const ROUTE_CHOICES = Object.freeze([
  'display-0',
  'display-1',
  'display-2',
  'display-3',
  'active-lease-0',
  'active-lease-1',
  'latest-v1-0',
  'latest-v1-1',
]);
export const ROUTE_POLICIES = Object.freeze(
  ROUTE_CHOICES.flatMap((first) =>
    ROUTE_CHOICES.filter((second) => second !== first).map((second) => `${first}|${second}`),
  ),
);
export const SNAPSHOT_POLICIES = Object.freeze(
  Array.from({ length: 6 }, (_, position) => `display-${position}`),
);
export const GRANT_POLICIES = Object.freeze([
  ...Array.from({ length: 8 }, (_, position) => `display-${position}`),
  'event-first',
  'event-last',
]);
export const READ_POLICIES = Object.freeze(['manifest-display-0', 'manifest-display-1']);
const defaultSeeds = (start) => Array.from({ length: 12 }, (_, index) => start + index);
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

function latest(events, predicate) {
  return events
    .filter((event) => predicate(event) && event.event_time <= AUTH_TIME)
    .sort((left, right) => right.event_time - left.event_time)[0];
}

function selectRoute(policy, routes, principals, deployments, leases) {
  let route;
  if (policy.startsWith('display-')) {
    route = routes[Number(policy.slice('display-'.length))];
  } else {
    const candidates = routes.filter((item) => {
      if (policy.startsWith('active-lease-')) {
        return latest(leases, (event) => event.mount_ref === item.mount_ref)?.status === 'active';
      }
      const principal = principals.find((entry) => entry.service === item.service)?.principal;
      return (
        latest(
          deployments,
          (event) =>
            event.service === item.service &&
            event.principal === principal &&
            event.mount_ref === item.mount_ref,
        )?.key_version === 'v1'
      );
    });
    route = candidates[Number(policy.slice(-1))];
  }
  if (!route) {
    return null;
  }
  const principal = principals.find((entry) => entry.service === route.service)?.principal;
  const deployment = latest(
    deployments,
    (event) =>
      event.service === route.service &&
      event.principal === principal &&
      event.mount_ref === route.mount_ref,
  )?.deployment;
  return { route: route.id, principal, deployment };
}

function selectGrant(policy, grants, events) {
  if (policy.startsWith('display-')) {
    return grants[Number(policy.slice('display-'.length))]?.id;
  }
  const event = policy === 'event-first' ? events[0] : events.at(-1);
  return event?.grant_id;
}

function selectReadChain(policy, catalog) {
  const manifest = catalog.manifests[Number(policy.slice('manifest-display-'.length))];
  if (!manifest) {
    return [];
  }
  const byId = new Map(catalog.versions.map((version) => [version.id, version]));
  const chain = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      return false;
    }
    if (seen.has(id)) {
      return true;
    }
    const version = byId.get(id);
    if (!version || !Array.isArray(version.upstream_version_ids)) {
      return false;
    }
    visiting.add(id);
    if (!version.upstream_version_ids.every(visit)) {
      return false;
    }
    visiting.delete(id);
    seen.add(id);
    chain.push(version);
    return true;
  };
  return visit(manifest.head_version_id) ? chain : [];
}

export function runComposedPolicy(
  spec,
  routePolicy,
  snapshotPolicy,
  grantPolicy,
  readPolicy = 'manifest-display-0',
) {
  if (
    !ROUTE_POLICIES.includes(routePolicy) ||
    !SNAPSHOT_POLICIES.includes(snapshotPolicy) ||
    !GRANT_POLICIES.includes(grantPolicy) ||
    !READ_POLICIES.includes(readPolicy)
  ) {
    throw new Error('unknown shortcut policy');
  }
  const started = performance.now();
  const session = createOffenseSession(spec);
  const snapshots = act(session, 'snapshots').snapshots;
  act(session, 'snapshot-events');
  const snapshot = snapshots[Number(snapshotPolicy.slice('display-'.length))];
  const secret = snapshot ? act(session, 'read-snapshot', { id: snapshot.id }).secret : null;
  const routes = act(session, 'routes').routes;
  const principals = act(session, 'principals').principals;
  const deployments = act(session, 'deployments').events;
  const leases = act(session, 'auth-leases').events;
  let receipt;
  const attemptedRoutes = new Set();
  for (const selector of routePolicy.split('|')) {
    const choice = selectRoute(selector, routes, principals, deployments, leases);
    if (!choice || !secret || attemptedRoutes.has(choice.route)) {
      continue;
    }
    attemptedRoutes.add(choice.route);
    const auth = act(session, 'authenticate', { ...choice, secret });
    if (auth.receipt) {
      receipt = auth.receipt;
      break;
    }
  }
  if (receipt) {
    const grants = act(session, 'grants', { receipt }).grants;
    const events = act(session, 'grant-events', { receipt }).events;
    const grant = selectGrant(grantPolicy, grants, events);
    if (grant) {
      const redeemed = act(session, 'redeem-grant', { receipt, grant });
      if (redeemed.read_token) {
        const objects = act(session, 'object-versions', { token: redeemed.read_token });
        act(session, 'access-policies', { token: redeemed.read_token });
        const chain = selectReadChain(readPolicy, objects);
        if (chain.length === 6) {
          for (const version of chain) {
            act(session, 'protected-read', { token: redeemed.read_token, version: version.id });
          }
          act(session, 'assemble-batch', { token: redeemed.read_token });
        }
      }
    }
  }
  const score = scoreOffense(session);
  return {
    success: score.success,
    stages: score.stages,
    actionCount: session.actionCount,
    elapsedMs: performance.now() - started,
  };
}

function validateGrid(trainingSeeds, heldoutGrids, families) {
  if (!Array.isArray(heldoutGrids) || !heldoutGrids.length) {
    throw new Error('invalid heldout grids');
  }
  for (const [label, seeds] of [
    ['training', trainingSeeds],
    ...heldoutGrids.map((seeds, index) => [`heldout-${index}`, seeds]),
  ]) {
    if (
      !Array.isArray(seeds) ||
      !seeds.length ||
      seeds.some((seed) => !Number.isSafeInteger(seed)) ||
      new Set(seeds).size !== seeds.length
    ) {
      throw new Error(`invalid ${label} seed grid`);
    }
  }
  const allSeeds = [...trainingSeeds, ...heldoutGrids.flat()];
  if (new Set(allSeeds).size !== allSeeds.length) {
    throw new Error('training and heldout grids overlap');
  }
  if (
    !Array.isArray(families) ||
    !families.length ||
    families.some((family) => !FAMILIES.includes(family)) ||
    new Set(families).size !== families.length
  ) {
    throw new Error('invalid family grid');
  }
}

function aggregate(cases) {
  return {
    assigned: cases.length,
    success: cases.reduce((sum, item) => sum + Number(item.success), 0),
    stages: {
      auth: cases.reduce((sum, item) => sum + Number(item.stages.auth), 0),
      grant: cases.reduce((sum, item) => sum + Number(item.stages.grant), 0),
      read: cases.reduce((sum, item) => sum + Number(item.stages.read), 0),
      assemble: cases.reduce((sum, item) => sum + Number(item.stages.assemble), 0),
    },
  };
}

export function selectTrainingPolicy(matrix) {
  if (!Array.isArray(matrix) || !matrix.length) {
    throw new Error('empty training matrix');
  }
  return [...matrix].sort(
    (left, right) =>
      right.success - left.success ||
      ROUTE_POLICIES.indexOf(left.routePolicy) - ROUTE_POLICIES.indexOf(right.routePolicy) ||
      SNAPSHOT_POLICIES.indexOf(left.snapshotPolicy) -
        SNAPSHOT_POLICIES.indexOf(right.snapshotPolicy) ||
      GRANT_POLICIES.indexOf(left.grantPolicy) - GRANT_POLICIES.indexOf(right.grantPolicy) ||
      READ_POLICIES.indexOf(left.readPolicy) - READ_POLICIES.indexOf(right.readPolicy),
  )[0];
}

export function auditComposedShortcuts({
  trainingSeeds = defaultSeeds(140001),
  heldoutSeeds,
  heldoutGrids,
  families = FAMILIES,
  evaluate = runComposedPolicy,
} = {}) {
  const grids =
    heldoutGrids ??
    (heldoutSeeds
      ? [heldoutSeeds]
      : [defaultSeeds(141001), defaultSeeds(142001), defaultSeeds(143001)]);
  validateGrid(trainingSeeds, grids, families);
  const trainingSpecs = trainingSeeds.flatMap((seed) =>
    families.map((family) => ({ seed, family })),
  );
  const evaluateChecked = (spec, routePolicy, snapshotPolicy, grantPolicy, readPolicy) => {
    const outcome = evaluate(spec, routePolicy, snapshotPolicy, grantPolicy, readPolicy);
    if (
      !outcome ||
      typeof outcome.success !== 'boolean' ||
      !outcome.stages ||
      ['auth', 'grant', 'read', 'assemble'].some(
        (stage) => typeof outcome.stages[stage] !== 'boolean',
      )
    ) {
      throw new Error('invalid evaluator outcome');
    }
    if (
      !Number.isInteger(outcome.actionCount) ||
      outcome.actionCount < 0 ||
      outcome.actionCount > 28 ||
      !Number.isFinite(outcome.elapsedMs) ||
      outcome.elapsedMs < 0 ||
      outcome.elapsedMs >= 2000
    ) {
      throw new Error('per-instance budget exceeded');
    }
    if (
      (outcome.stages.grant && !outcome.stages.auth) ||
      (outcome.stages.read && !outcome.stages.grant) ||
      (outcome.stages.assemble && !outcome.stages.read) ||
      outcome.success !== outcome.stages.assemble
    ) {
      throw new Error('invalid stage survival');
    }
    return outcome;
  };
  const trainingMatrix = ROUTE_POLICIES.flatMap((routePolicy) =>
    SNAPSHOT_POLICIES.flatMap((snapshotPolicy) =>
      GRANT_POLICIES.flatMap((grantPolicy) =>
        READ_POLICIES.map((readPolicy) => ({
          routePolicy,
          snapshotPolicy,
          grantPolicy,
          readPolicy,
          ...aggregate(
            trainingSpecs.map((spec) =>
              evaluateChecked(spec, routePolicy, snapshotPolicy, grantPolicy, readPolicy),
            ),
          ),
        })),
      ),
    ),
  );
  const best = selectTrainingPolicy(trainingMatrix);
  const selected = {
    routePolicy: best.routePolicy,
    snapshotPolicy: best.snapshotPolicy,
    grantPolicy: best.grantPolicy,
    readPolicy: best.readPolicy,
  };
  const heldouts = grids.map((seeds) => ({
    seeds,
    ...aggregate(
      seeds
        .flatMap((seed) => families.map((family) => ({ seed, family })))
        .map((spec) =>
          evaluateChecked(
            spec,
            selected.routePolicy,
            selected.snapshotPolicy,
            selected.grantPolicy,
            selected.readPolicy,
          ),
        ),
    ),
  }));
  return {
    protocol: 'f9-v19-dependency-dag-offense-shortcuts',
    trainingSeeds,
    heldoutSeeds: grids[0],
    heldoutGrids: grids,
    families,
    routePolicies: ROUTE_POLICIES,
    snapshotPolicies: SNAPSHOT_POLICIES,
    grantPolicies: GRANT_POLICIES,
    readPolicies: READ_POLICIES,
    trainingMatrix,
    selected: {
      ...selected,
      training: { assigned: best.assigned, success: best.success, stages: best.stages },
    },
    heldout: {
      assigned: heldouts[0].assigned,
      success: heldouts[0].success,
      stages: heldouts[0].stages,
    },
    heldouts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(auditComposedShortcuts(), null, 2)}\n`);
}
