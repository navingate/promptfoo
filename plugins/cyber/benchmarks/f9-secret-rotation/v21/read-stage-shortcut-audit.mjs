#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { FAMILIES } from '../v10/graph.mjs';
import { referenceOffense, scoreOffense, stepOffense } from './offense.mjs';

export const MANIFEST_POLICIES = Object.freeze(['display-0', 'display-1', 'display-2']);
export const PERMIT_POLICIES = Object.freeze([
  'display-first',
  'display-last',
  'principal-first',
  'principal-last',
  'active-first',
  'active-last',
]);
const defaultSeeds = (first) => Array.from({ length: 12 }, (_, index) => first + index);
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

function latestPermitStatus(events, id, at) {
  const current = (event) =>
    event.permit_id === id && event.event_time <= at && event.effective_at <= at;
  const newest = (left, right) =>
    right.effective_at - left.effective_at || right.event_time - left.event_time;
  return events.filter(current).sort(newest)[0];
}

function orderedVersions(catalog, head) {
  const byId = new Map(catalog.versions.map((version) => [version.id, version]));
  const order = [];
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
    order.push(version);
    return true;
  };
  return visit(head) ? order : [];
}

function selectPermit(policy, catalog, access, version) {
  let candidates = access.permits.filter((permit) => permit.version_id === version.id);
  if (policy.startsWith('principal-')) {
    candidates = candidates.filter(
      (permit) =>
        permit.principal === catalog.context.principal &&
        permit.deployment_ref === catalog.context.deployment &&
        permit.resource === catalog.context.resource,
    );
  } else if (policy.startsWith('active-')) {
    const active = (permit) =>
      latestPermitStatus(access.events, permit.id, catalog.context.at)?.status === 'active';
    candidates = candidates.filter(active);
  }
  return (policy.endsWith('-last') ? candidates.at(-1) : candidates[0])?.id;
}

/** Give the shortcut a valid visible auth and grant, then vary only read-stage choices. */
export function runReadStagePolicy(spec, manifestPolicy, permitPolicy) {
  if (!MANIFEST_POLICIES.includes(manifestPolicy) || !PERMIT_POLICIES.includes(permitPolicy)) {
    throw new Error('unknown read-stage shortcut policy');
  }
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  if (typeof token !== 'string') {
    throw new Error('visible reference did not obtain a grant');
  }
  const catalog = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  act(session, 'release-attestations', { token });
  const manifest = catalog.manifests[Number(manifestPolicy.slice('display-'.length))];
  const chain = orderedVersions(catalog, manifest.head_version_id);
  for (const version of chain) {
    act(session, 'protected-read', {
      token,
      version: version.id,
      permit: selectPermit(permitPolicy, catalog, access, version),
    });
  }
  act(session, 'assemble-batch', { token });
  if (session.actionCount > session.initial.limits.total_actions) {
    throw new Error('read-stage shortcut exceeded action budget');
  }
  const score = scoreOffense(session);
  return { success: score.success, stages: score.stages, actionCount: session.actionCount };
}

function validateGrids(trainingSeeds, heldoutGrids, families) {
  if (!Array.isArray(heldoutGrids) || !Array.isArray(families)) {
    throw new Error('invalid read-stage shortcut grid');
  }
  const grids = [trainingSeeds, ...heldoutGrids];
  if (
    !heldoutGrids.length ||
    grids.some(
      (seeds) =>
        !Array.isArray(seeds) ||
        !seeds.length ||
        seeds.some((seed) => !Number.isSafeInteger(seed)) ||
        new Set(seeds).size !== seeds.length,
    ) ||
    new Set(grids.flat()).size !== grids.flat().length ||
    !families.length ||
    families.some((family) => !FAMILIES.includes(family)) ||
    new Set(families).size !== families.length
  ) {
    throw new Error('invalid read-stage shortcut grid');
  }
}

function aggregate(seeds, families, manifestPolicy, permitPolicy) {
  const outcomes = seeds.flatMap((seed) =>
    families.map((family) => runReadStagePolicy({ seed, family }, manifestPolicy, permitPolicy)),
  );
  return {
    assigned: outcomes.length,
    success: outcomes.filter((outcome) => outcome.success).length,
    stages: Object.fromEntries(
      ['auth', 'grant', 'read', 'assemble'].map((stage) => [
        stage,
        outcomes.filter((outcome) => outcome.stages[stage]).length,
      ]),
    ),
    maxActions: Math.max(...outcomes.map((outcome) => outcome.actionCount)),
  };
}

export function auditReadStageShortcuts({
  trainingSeeds = defaultSeeds(160001),
  heldoutGrids = [defaultSeeds(161001), defaultSeeds(162001), defaultSeeds(163001)],
  families = FAMILIES,
} = {}) {
  validateGrids(trainingSeeds, heldoutGrids, families);
  const trainingMatrix = MANIFEST_POLICIES.flatMap((manifestPolicy) =>
    PERMIT_POLICIES.map((permitPolicy) => ({
      manifestPolicy,
      permitPolicy,
      ...aggregate(trainingSeeds, families, manifestPolicy, permitPolicy),
    })),
  );
  const selected = [...trainingMatrix].sort(
    (left, right) =>
      right.success - left.success ||
      MANIFEST_POLICIES.indexOf(left.manifestPolicy) -
        MANIFEST_POLICIES.indexOf(right.manifestPolicy) ||
      PERMIT_POLICIES.indexOf(left.permitPolicy) - PERMIT_POLICIES.indexOf(right.permitPolicy),
  )[0];
  return {
    protocol: 'f9-v21-visible-grant-read-stage-shortcuts',
    trainingSeeds,
    heldoutGrids,
    families,
    trainingMatrix,
    selected,
    heldouts: heldoutGrids.map((seeds) => ({
      seeds,
      ...aggregate(seeds, families, selected.manifestPolicy, selected.permitPolicy),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(auditReadStageShortcuts(), null, 2)}\n`);
}
