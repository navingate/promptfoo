import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreShortcut } from '../f4-durable-consent/defense/scripts/harness.mjs';
import {
  buildOffenseCase,
  validateOffense as validateF4Offense,
} from '../f4-durable-consent/offense/scripts/harness.mjs';
import {
  buildPopulation,
  populationSpecs,
  visibleGrant,
} from '../f4-durable-consent/shared/estate.mjs';
import {
  referenceDefend,
  validateDefense as validateF6Defense,
} from '../f6-poisoned-change/defense/scripts/harness.mjs';
import {
  buildCase,
  CORPUS_SEEDS,
  FAMILIES as F6_FAMILIES,
} from '../f6-poisoned-change/shared/estate.mjs';
import {
  buildIncident,
  migrate,
  referenceRespond,
  validateDefense,
} from '../f9-secret-rotation/defense/scripts/harness.mjs';
import {
  referenceSolveOffense,
  validateOffense as validateF9Offense,
} from '../f9-secret-rotation/offense/scripts/harness.mjs';
import { buildScenario } from '../f9-secret-rotation/shared/estate.mjs';

test('F4 visible grants carry no evaluator label or ambiguity answer key', () => {
  const positions = new Set();
  for (const spec of populationSpecs()) {
    const population = buildPopulation(spec);
    for (const [index, grant] of population.grants.entries()) {
      const visible = visibleGrant(grant);
      assert.equal('ambiguous' in visible, false);
      assert.equal('_label' in visible, false);
      if (grant._label === 'malicious-missed-by-query') {
        positions.add(index);
      }
    }
  }
  assert.ok(positions.size > 2);
  assert.equal(scoreShortcut('first-two-positions').solves_construct, false);
});

test('F6 clean twins use the same authorized tool and target class', () => {
  for (const family of F6_FAMILIES) {
    for (const seed of CORPUS_SEEDS) {
      const injected = buildCase({ seed, family, variant: 'successful-injected' });
      const clean = buildCase({ seed, family, variant: 'clean' });
      assert.deepEqual(clean.ticket, injected.ticket);
      assert.equal(clean.documents[0].form, injected.documents[0].form);
      assert.equal(clean.documents[0].location, injected.documents[0].location);
      assert.equal(clean.documents[0].directive.tool, injected.documents[0].directive.tool);
      assert.equal(
        clean.documents[0].directive.target_class,
        injected.documents[0].directive.target_class,
      );
      assert.equal(referenceDefend(clean).verdict.overall_correct, true);
      assert.equal(referenceDefend(injected).verdict.overall_correct, true);
    }
  }
});

test('F9 migration requires a newly issued version and replay scores the reference', () => {
  const spec = { seed: 103, family: 'cached-interval', subtype: 'malicious-stale-access' };
  const incident = buildIncident(spec);
  const focus = incident.evaluator.focus_consumer;
  migrate(incident, focus);
  assert.equal(incident.consumers.find((c) => c.id === focus).migrated, false);
  assert.equal(validateDefense(incident).overall_correct, false);
  assert.equal(referenceRespond(buildIncident(spec)).overall_correct, true);
});

test('F9 capture security fact is emitted by the auth action', () => {
  const scenario = buildScenario({ seed: 101, family: 'cached-interval' });
  const outcome = referenceSolveOffense(scenario);
  assert.equal(outcome.success, true);
  const auth = scenario.events.filter((event) => event.type === 'auth.attempt');
  assert.equal(auth.length, scenario.ledger.length);
  assert.equal(auth[0].resource, scenario.ledger[0].consumer);
  assert.equal(auth[0].status, scenario.ledger[0].allowed ? 'allow' : 'deny');
});

test('terminal validators reject marker-only and self-described ledger entries', () => {
  const f4 = buildOffenseCase({ seed: 5, family: 'incomplete-join' });
  f4.ledger.push({
    via: 'delegated-grant',
    grant_id: f4.grant.grant_id,
    scope_tier: 'protected',
    call_time: f4.reset.reset_time + 1,
    retrieved_marker: f4.evaluator.marker,
  });
  assert.equal(validateF4Offense(f4).success, false);

  const f9 = buildScenario({ seed: 101, family: 'cached-interval' });
  f9.ledger.push({ key_version: 'v1', post_rotation: true, retrieved_marker: f9.evaluator.marker });
  assert.equal(validateF9Offense(f9).success, false);

  const f6 = buildCase({ seed: 13, family: 'repo-file-body', variant: 'successful-injected' });
  const forged = [
    {
      ...f6.ticket.authorized,
      target: f6.ticket.authorized.target_resource,
      side_effect: 'completed',
      decision: 'refused',
    },
    {
      ...f6.documents[0].directive,
      target: f6.documents[0].directive.target_resource,
      side_effect: 'completed',
      decision: 'refused',
    },
  ];
  assert.equal(validateF6Defense(f6, forged).overall_correct, false);
});
