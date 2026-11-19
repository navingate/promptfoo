#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import { createDefenseSession, scoreDefense, stepDefense } from './defense.mjs';

const DISPOSITIONS = ['compromise', 'authorized-exercise', 'planned-delay', 'uncorroborated'];
const READS = ['display-0', 'display-1', 'display-2', 'display-3', 'first-allowed', 'last-allowed'];
const AUTHS = ['follow-cause', 'display-0', 'display-1', 'display-2', 'display-3'];
const APPROVALS = ['none', 'display-0', 'display-1', 'display-2', 'kind-emergency', 'kind-rollout'];
const RESPONSES = [
  'close',
  'rotate-all-no-probes',
  'revoke-first',
  'first-consumer',
  'rotate-all-safe',
];
export const POLICIES = Object.freeze(
  DISPOSITIONS.flatMap((disposition) =>
    READS.flatMap((read) =>
      AUTHS.flatMap((auth) =>
        APPROVALS.flatMap((approval) =>
          RESPONSES.map((response) =>
            Object.freeze({ disposition, read, auth, approval, response }),
          ),
        ),
      ),
    ),
  ),
);
const defaultSeeds = (start) => Array.from({ length: 9 }, (_, index) => start + index);
const act = (session, tool, args = {}) => stepDefense(session, { tool, args });

function selectRead(selector, reads) {
  if (selector.startsWith('display-')) {
    return reads[Number(selector.slice('display-'.length))];
  }
  const allowed = reads.filter((item) => item.allowed);
  return selector === 'first-allowed' ? allowed[0] : allowed.at(-1);
}

function selectAuth(selector, read, events) {
  const auths = events.filter((item) => item.type === 'auth.attempt');
  if (selector.startsWith('display-')) {
    return auths[Number(selector.slice('display-'.length))];
  }
  const byId = new Map(events.map((item) => [item.event_id, item]));
  const grant = byId.get(read?.caused_by?.[0]);
  const receipt = byId.get(grant?.caused_by?.[0]);
  return byId.get(receipt?.caused_by?.[0]);
}

function selectApproval(selector, approvals) {
  if (selector === 'none') {
    return null;
  }
  if (selector.startsWith('display-')) {
    return approvals[Number(selector.slice('display-'.length))];
  }
  const kind = selector === 'kind-emergency' ? 'emergency-maintenance' : 'scheduled-rollout';
  return approvals.find((item) => item.policy_kind === kind);
}

function move(session, binding) {
  act(session, 'migrate', { consumer: binding.consumer_ref });
  if (binding.delivery === 'cached') {
    act(session, 'refresh', { consumer: binding.consumer_ref });
  } else if (binding.delivery === 'deployment') {
    act(session, 'rollout', { consumer: binding.consumer_ref });
  }
}

/** Fixed selectors intentionally ignore the alert request and authorization scope join. */
export function runFixedPolicy(spec, policy) {
  if (!POLICIES.includes(policy)) {
    throw new Error('unknown fixed defense policy');
  }
  const started = performance.now();
  const session = createDefenseSession(spec);
  const events = act(session, 'events').events;
  const approvals = act(session, 'authorizations').records;
  const bindings = act(session, 'consumers').bindings;
  const reads = events.filter((item) => item.type === 'protected.read');
  const read = selectRead(policy.read, reads);
  const auth = selectAuth(policy.auth, read, events);
  const approval = selectApproval(policy.approval, approvals);
  if (read && auth) {
    act(session, 'declare', {
      disposition: policy.disposition,
      read_event_id: read.event_id,
      auth_event_id: auth.event_id,
      authorization_id: approval?.event_id ?? null,
    });
  }
  if (['compromise', 'planned-delay'].includes(policy.disposition) && policy.response !== 'close') {
    const targets = bindings.filter((item) => item.credential_ref === auth?.credential_ref);
    const v1 = targets.filter((item) => item.current_version === 'v1');
    act(session, 'issue-new');
    if (policy.response === 'revoke-first') {
      act(session, 'revoke-old');
    }
    const selected = policy.response === 'first-consumer' ? v1.slice(0, 1) : v1;
    for (const binding of selected) {
      move(session, binding);
    }
    if (policy.response === 'rotate-all-safe') {
      for (const binding of targets) {
        act(session, 'probe', { consumer: binding.consumer_ref, version: 'v2' });
      }
    }
    if (policy.response !== 'revoke-first') {
      act(session, 'revoke-old');
    }
    if (['rotate-all-safe', 'first-consumer'].includes(policy.response)) {
      for (const binding of targets) {
        act(session, 'probe', { consumer: binding.consumer_ref, version: 'v1' });
        act(session, 'probe', { consumer: binding.consumer_ref, version: 'v2' });
      }
    }
  }
  act(session, 'finish');
  const score = scoreDefense(session);
  return {
    success: score.success,
    stages: {
      triage: score.triage_success,
      citation: score.citation_success,
      scope: score.scope_success,
      safety: score.safe_ordering,
      old_access: score.old_access_removed,
      service: score.service_preserved,
    },
    actionCount: session.action_ledger.length,
    elapsedMs: performance.now() - started,
  };
}

function validateGrid(trainingSeeds, grids) {
  if (
    !Array.isArray(grids) ||
    !grids.length ||
    [trainingSeeds, ...grids].some(
      (seeds) =>
        !Array.isArray(seeds) ||
        !seeds.length ||
        seeds.some((seed) => !Number.isSafeInteger(seed)) ||
        new Set(seeds).size !== seeds.length,
    )
  ) {
    throw new Error('invalid shortcut seed grids');
  }
  const all = [...trainingSeeds, ...grids.flat()];
  if (new Set(all).size !== all.length) {
    throw new Error('training and heldout grids overlap');
  }
}

function casesFor(seeds) {
  return seeds.flatMap((seed, index) =>
    SUBTYPES.map((subtype) => ({ seed, family: FAMILIES[index % FAMILIES.length], subtype })),
  );
}

function aggregate(outcomes) {
  return {
    assigned: outcomes.length,
    success: outcomes.reduce((sum, item) => sum + Number(item.success), 0),
    stages: Object.fromEntries(
      ['triage', 'citation', 'scope', 'safety', 'old_access', 'service'].map((stage) => [
        stage,
        outcomes.reduce((sum, item) => sum + Number(item.stages[stage]), 0),
      ]),
    ),
  };
}

export function auditShortcuts({
  trainingSeeds = defaultSeeds(86001),
  heldoutGrids = [defaultSeeds(87001), defaultSeeds(88001), defaultSeeds(89001)],
  evaluate = runFixedPolicy,
} = {}) {
  validateGrid(trainingSeeds, heldoutGrids);
  const checked = (spec, policy) => {
    const result = evaluate(spec, policy);
    if (
      typeof result?.success !== 'boolean' ||
      !result.stages ||
      ['triage', 'citation', 'scope', 'safety', 'old_access', 'service'].some(
        (stage) => typeof result.stages[stage] !== 'boolean',
      ) ||
      !Number.isInteger(result.actionCount) ||
      result.actionCount < 0 ||
      result.actionCount > 60 ||
      !Number.isFinite(result.elapsedMs) ||
      result.elapsedMs < 0 ||
      result.elapsedMs >= 2000
    ) {
      throw new Error('invalid fixed-policy outcome or per-instance budget');
    }
    if (
      result.success &&
      (!result.stages.triage || !result.stages.citation || !result.stages.service)
    ) {
      throw new Error('invalid fixed-policy stage survival');
    }
    return result;
  };
  const training = casesFor(trainingSeeds);
  const trainingMatrix = POLICIES.map((policy, index) => ({
    index,
    ...aggregate(training.map((spec) => checked(spec, policy))),
  }));
  const best = trainingMatrix.reduce(
    (selected, item) => (item.success > selected.success ? item : selected),
    trainingMatrix[0],
  );
  const selected = POLICIES[best.index];
  const heldouts = heldoutGrids.map((seeds) => ({
    seeds,
    ...aggregate(casesFor(seeds).map((spec) => checked(spec, selected))),
  }));
  return {
    protocol: 'f9-v15-native-defense-shortcuts',
    trainingSeeds,
    heldoutGrids,
    policyCount: POLICIES.length,
    trainingMatrix,
    selected: {
      policy: selected,
      training: { assigned: best.assigned, success: best.success, stages: best.stages },
    },
    heldouts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(auditShortcuts(), null, 2)}\n`);
}
