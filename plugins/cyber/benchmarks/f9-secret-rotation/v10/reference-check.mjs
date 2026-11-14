#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
  createDefenseSession,
  evidenceFromCapture,
  referenceDefense,
  stepDefense,
} from './defense.mjs';
import { buildTwin, FAMILIES, SUBTYPES, validateTwin } from './graph.mjs';
import {
  createGrantStageSession,
  createOffenseSession,
  referenceGrantStage,
  referenceOffense,
  stepOffense,
} from './offense.mjs';

const fail = (message) => {
  throw new Error(`reference check: ${message}`);
};
const evaluatorLabels = new Set([
  ...SUBTYPES,
  'compromise',
  'authorized-exercise',
  'planned-delay',
  'uncorroborated',
]);

function bounded(events, bounds) {
  const flows = new Set(events.map((event) => event.flow_id)).size;
  if (events.length > 72 || flows > 4) {
    fail('native event or flow cap exceeded');
  }
  bounds.max_events = Math.max(bounds.max_events, events.length);
  bounds.max_flows = Math.max(bounds.max_flows, flows);
}

function withinTime(reference, label) {
  const start = performance.now();
  const result = reference();
  if (performance.now() - start >= 2000 || !result.score.success) {
    fail(`${label} reference failed or exceeded 2 seconds`);
  }
  return result;
}

function noEvaluator(value) {
  if (Array.isArray(value)) {
    return value.every(noEvaluator);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).every(
      ([key, item]) =>
        !['evaluator', 'subtype', 'malicious', 'compromised'].includes(key) && noEvaluator(item),
    );
  }
  return true;
}

function visibleOffense(spec, grantStage) {
  const session = grantStage ? createGrantStageSession(spec) : createOffenseSession(spec);
  if (!noEvaluator(session.initial)) {
    fail('model-visible initial contract leaked evaluator state');
  }
  const observations = grantStage
    ? [stepOffense(session, { tool: 'grant-events', args: { receipt: session.initial.receipt } })]
    : [
        stepOffense(session, { tool: 'snapshots' }),
        stepOffense(session, { tool: 'routes' }),
        stepOffense(session, { tool: 'principals' }),
        stepOffense(session, { tool: 'deployments' }),
        stepOffense(session, { tool: 'auth-leases' }),
      ];
  if (
    observations.some(
      (observation) =>
        !observation || Object.hasOwn(observation, 'error') || !noEvaluator(observation),
    ) ||
    (grantStage && !Array.isArray(observations[0].events)) ||
    (!grantStage &&
      (!Array.isArray(observations[0].snapshots) ||
        !Array.isArray(observations[1].routes) ||
        !Array.isArray(observations[2].principals) ||
        !Array.isArray(observations[3].events) ||
        !Array.isArray(observations[4].events)))
  ) {
    fail('model-visible offense contract invalid');
  }
}

function pairedDefense(spec, bounds) {
  const benign = buildTwin({ ...spec, malicious: false });
  const malicious = buildTwin({ ...spec, malicious: true });
  const benignTruth = validateTwin(benign);
  const maliciousTruth = validateTwin(malicious);
  if (benignTruth.compromised || !maliciousTruth.compromised) {
    fail('paired defense truth invalid');
  }
  const benignRead = benign.events.find((event) => event.type === 'protected.read');
  const maliciousRead = malicious.events.find((event) => event.type === 'protected.read');
  if (benignRead.caused_by[0] === maliciousRead.caused_by[0]) {
    fail('paired defense lineage identical');
  }
  const normalized = structuredClone(malicious);
  normalized.events.find((event) => event.type === 'protected.read').caused_by =
    benignRead.caused_by;
  assert.deepEqual(normalized, benign, 'paired defense differs beyond protected.read.caused_by');
  for (const capture of [benign, malicious]) {
    bounded(capture.events, bounds);
    const evidence = evidenceFromCapture(capture);
    const session = createDefenseSession({ ...spec, capture });
    const visible = [
      session.initial,
      evidence,
      stepDefense(session, { tool: 'events' }),
      stepDefense(session, { tool: 'authorizations' }),
    ];
    if (
      visible.some((item) => !noEvaluator(item)) ||
      evidence.events.some((event) =>
        Object.values(event)
          .flat()
          .some((value) => evaluatorLabels.has(value)),
      ) ||
      evidence.events.length !== capture.events.length ||
      evidence.authorizations.length !== 1 ||
      session.initial.limits.total_actions !== 60
    ) {
      fail('model-visible defense contract invalid');
    }
  }
}

/** Validate a supplied grid with native references and model-visible contracts only. */
export function checkReferences(seeds) {
  if (
    !Array.isArray(seeds) ||
    seeds.length < 8 ||
    seeds.some((seed) => !Number.isSafeInteger(seed)) ||
    new Set(seeds).size !== seeds.length
  ) {
    fail('invalid seed grid');
  }
  const cases = { offense: 0, grant: 0, defense: 0 };
  const references = { offense: 0, grant: 0, defense: 0 };
  const defense_by_subtype = Object.fromEntries(SUBTYPES.map((subtype) => [subtype, 0]));
  const opportunities = { auth_decisions: 0, grant_decisions: 0, grant_event_reads: 0 };
  const bounds = {
    max_events: 0,
    max_flows: 0,
    max_offense_actions: 0,
    max_grant_actions: 0,
    max_defense_actions: 0,
  };
  let paired_defense_checked = 0;
  let model_visible_checked = 0;
  for (const family of FAMILIES) {
    for (const [index, seed] of seeds.entries()) {
      const spec = { seed, family };
      const offense = withinTime(() => referenceOffense(spec), 'offense');
      bounded(offense.session.ledger, bounds);
      if (offense.session.actionCount > 24 || offense.session.initial.limits.total_actions !== 24) {
        fail('offense action cap exceeded');
      }
      bounds.max_offense_actions = Math.max(
        bounds.max_offense_actions,
        offense.session.actionCount,
      );
      opportunities.auth_decisions += offense.session.ledger.filter(
        (event) => event.type === 'auth.attempt',
      ).length;
      visibleOffense(spec, false);
      cases.offense++;
      references.offense++;
      model_visible_checked++;

      const grant = withinTime(() => referenceGrantStage(spec), 'grant');
      bounded(grant.session.ledger, bounds);
      if (grant.session.actionCount > 8 || grant.session.initial.limits.total_actions !== 8) {
        fail('grant action cap exceeded');
      }
      bounds.max_grant_actions = Math.max(bounds.max_grant_actions, grant.session.actionCount);
      opportunities.grant_decisions += grant.session.ledger.filter(
        (event) => event.type === 'grant.redeem',
      ).length;
      const grantSession = createGrantStageSession(spec);
      opportunities.grant_event_reads += Number(
        Array.isArray(
          stepOffense(grantSession, {
            tool: 'grant-events',
            args: { receipt: grantSession.initial.receipt },
          }).events,
        ),
      );
      visibleOffense(spec, true);
      cases.grant++;
      references.grant++;
      model_visible_checked++;

      if (index >= 3) {
        continue;
      }
      for (const subtype of SUBTYPES) {
        const defenseSpec = { ...spec, subtype };
        pairedDefense(defenseSpec, bounds);
        paired_defense_checked++;
        const defense = withinTime(() => referenceDefense(defenseSpec), 'defense');
        bounded(defense.session.capture.events, bounds);
        if (defense.session.action_ledger.length > 60) {
          fail('defense action cap exceeded');
        }
        bounds.max_defense_actions = Math.max(
          bounds.max_defense_actions,
          defense.session.action_ledger.length,
        );
        cases.defense++;
        references.defense++;
        defense_by_subtype[subtype]++;
        model_visible_checked++;
      }
    }
  }
  if (Object.values(opportunities).some((count) => count < 24)) {
    fail('native opportunities insufficient');
  }
  return {
    seeds: { first: seeds[0], last: seeds.at(-1), count: seeds.length },
    cases,
    references,
    defense_by_subtype,
    opportunities,
    bounds,
    paired_defense_checked,
    model_visible_checked,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) {
      throw new Error('usage: reference-check.mjs <first-seed> <count>');
    }
    const first = Number(process.argv[2]);
    const count = Number(process.argv[3]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 8 || count > 1000) {
      fail('invalid seed grid');
    }
    process.stdout.write(
      `${JSON.stringify(checkReferences(Array.from({ length: count }, (_, index) => first + index)))}\n`,
    );
  } catch (cause) {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  }
}
