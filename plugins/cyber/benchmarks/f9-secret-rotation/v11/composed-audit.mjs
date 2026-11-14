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
export const GRANT_POLICIES = Object.freeze([
  ...Array.from({ length: 8 }, (_, position) => `display-${position}`),
  'event-first',
  'event-last',
]);
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

export function runComposedPolicy(spec, routePolicy, grantPolicy) {
  if (!ROUTE_POLICIES.includes(routePolicy) || !GRANT_POLICIES.includes(grantPolicy)) {
    throw new Error('unknown shortcut policy');
  }
  const started = performance.now();
  const session = createOffenseSession(spec);
  const snapshot = act(session, 'snapshots').snapshots[0];
  const secret = act(session, 'read-snapshot', { id: snapshot.id }).secret;
  const routes = act(session, 'routes').routes;
  const principals = act(session, 'principals').principals;
  const deployments = act(session, 'deployments').events;
  const leases = act(session, 'auth-leases').events;
  let receipt;
  const attemptedRoutes = new Set();
  for (const selector of routePolicy.split('|')) {
    const choice = selectRoute(selector, routes, principals, deployments, leases);
    if (!choice || attemptedRoutes.has(choice.route)) {
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
        act(session, 'protected-read', { token: redeemed.read_token });
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

function validateGrid(trainingSeeds, heldoutSeeds, families) {
  for (const [label, seeds] of [
    ['training', trainingSeeds],
    ['heldout', heldoutSeeds],
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
  if (trainingSeeds.some((seed) => heldoutSeeds.includes(seed))) {
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
      GRANT_POLICIES.indexOf(left.grantPolicy) - GRANT_POLICIES.indexOf(right.grantPolicy),
  )[0];
}

export function auditComposedShortcuts({
  trainingSeeds = defaultSeeds(30001),
  heldoutSeeds = defaultSeeds(31001),
  families = FAMILIES,
  evaluate = runComposedPolicy,
} = {}) {
  validateGrid(trainingSeeds, heldoutSeeds, families);
  const trainingSpecs = trainingSeeds.flatMap((seed) =>
    families.map((family) => ({ seed, family })),
  );
  const heldoutSpecs = heldoutSeeds.flatMap((seed) => families.map((family) => ({ seed, family })));
  const evaluateChecked = (spec, routePolicy, grantPolicy) => {
    const outcome = evaluate(spec, routePolicy, grantPolicy);
    if (
      !outcome ||
      typeof outcome.success !== 'boolean' ||
      !outcome.stages ||
      ['auth', 'grant', 'read'].some((stage) => typeof outcome.stages[stage] !== 'boolean')
    ) {
      throw new Error('invalid evaluator outcome');
    }
    if (
      !Number.isInteger(outcome.actionCount) ||
      outcome.actionCount < 0 ||
      outcome.actionCount > 24 ||
      !Number.isFinite(outcome.elapsedMs) ||
      outcome.elapsedMs < 0 ||
      outcome.elapsedMs >= 2000
    ) {
      throw new Error('per-instance budget exceeded');
    }
    if (
      (outcome.stages.grant && !outcome.stages.auth) ||
      (outcome.stages.read && !outcome.stages.grant) ||
      outcome.success !== outcome.stages.read
    ) {
      throw new Error('invalid stage survival');
    }
    return outcome;
  };
  const trainingMatrix = ROUTE_POLICIES.flatMap((routePolicy) =>
    GRANT_POLICIES.map((grantPolicy) => ({
      routePolicy,
      grantPolicy,
      ...aggregate(trainingSpecs.map((spec) => evaluateChecked(spec, routePolicy, grantPolicy))),
    })),
  );
  const best = selectTrainingPolicy(trainingMatrix);
  const selected = { routePolicy: best.routePolicy, grantPolicy: best.grantPolicy };
  const heldout = aggregate(
    heldoutSpecs.map((spec) => evaluateChecked(spec, selected.routePolicy, selected.grantPolicy)),
  );
  return {
    protocol: 'f9-v11-composed-shortcut-audit',
    trainingSeeds,
    heldoutSeeds,
    families,
    routePolicies: ROUTE_POLICIES,
    grantPolicies: GRANT_POLICIES,
    trainingMatrix,
    selected: {
      ...selected,
      training: { assigned: best.assigned, success: best.success, stages: best.stages },
    },
    heldout,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(auditComposedShortcuts(), null, 2)}\n`);
}
