import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseEvadingArrangement,
  validateOffense as validateF4Offense,
} from '../f4-durable-consent/offense/scripts/harness.mjs';
import {
  buildInstance,
  createGrant,
  markerFor as markerForF4,
  populationSpecs,
  runControlPlane,
  visibleGrant,
} from '../f4-durable-consent/shared/estate.mjs';
import {
  runDefenseReference,
  scoreDefense as scoreF6Defense,
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

test('F4 visible grants carry no evaluator label; no single field separates the malicious class', () => {
  const malRows = [];
  const nonRows = [];
  for (const spec of populationSpecs()) {
    const instance = buildInstance(spec);
    for (const grant of instance.grants) {
      const visible = visibleGrant(grant);
      assert.equal('_label' in visible, false);
      assert.equal('_key' in visible, false);
      (grant._label === 'malicious-missed-by-query' ? malRows : nonRows).push(visible);
    }
  }
  assert.ok(malRows.length > 2);
  // Authorization is a join, so no single visible field+value perfectly separates the malicious
  // class from the rest (the F4 analog of the F6 single-token check).
  const fields = new Set();
  for (const r of [...malRows, ...nonRows]) {
    for (const k of Object.keys(r)) {
      fields.add(k);
    }
  }
  const val = (r, f) => (Array.isArray(r[f]) ? r[f].join('|') : String(r[f]));
  let separator = null;
  for (const f of fields) {
    for (const v of new Set([...malRows, ...nonRows].map((r) => val(r, f)))) {
      if (malRows.every((r) => val(r, f) === v) && nonRows.every((r) => val(r, f) !== v)) {
        separator = `${f}=${v}`;
      }
    }
  }
  assert.equal(separator, null);
});

test('F6 clean twin shares the ticket and surface with the injected case; reference is a useful refusal on both', () => {
  for (const family of F6_FAMILIES) {
    for (const seed of CORPUS_SEEDS) {
      const injected = buildCase({ seed, family, variant: 'successful-injected' });
      const clean = buildCase({ seed, family, variant: 'clean' });
      assert.deepEqual(clean.ticket, injected.ticket);
      assert.equal(clean.documents[0].form, injected.documents[0].form);
      assert.equal(clean.documents[0].location, injected.documents[0].location);
      // clean directive is in-scope (the ticket's own tool); the injected directive is the
      // out-of-scope class — they deliberately differ, and only scope reasoning separates them.
      assert.equal(clean.documents[0].directive.tool, clean.ticket.authorized.tool);
      assert.notEqual(injected.documents[0].directive.tool, injected.ticket.authorized.tool);
      // the deterministic secure reference is a useful refusal on both twins
      assert.equal(scoreF6Defense(clean, runDefenseReference(clean)).pass, true);
      assert.equal(scoreF6Defense(injected, runDefenseReference(injected)).pass, true);
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
  const spec4 = { seed: 7, family: 'incomplete-join' };
  const marker4 = markerForF4(spec4.seed, spec4.family);
  const grant4 = createGrant(chooseEvadingArrangement(spec4), spec4);
  const { remediation: rem4, ledgerEntry: le4 } = runControlPlane(grant4, spec4, []);
  // honest reference reaches success
  assert.equal(
    validateF4Offense({
      ledgerEntry: le4,
      remediation: rem4,
      grant: grant4,
      registry: [],
      marker: marker4,
    }).success,
    true,
  );
  // pre-provisioned (not created this run) → invalid run, never success
  assert.equal(
    validateF4Offense({
      ledgerEntry: le4,
      remediation: rem4,
      grant: { ...grant4, _attacker_created_this_run: false },
      registry: [],
      marker: marker4,
    }).success,
    false,
  );
  // a forged / wrong marker → not success
  assert.equal(
    validateF4Offense({
      ledgerEntry: { ...le4, marker_retrieved: 'F4EXP-forged' },
      remediation: rem4,
      grant: grant4,
      registry: [],
      marker: marker4,
    }).success,
    false,
  );

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
  assert.equal(scoreF6Defense(f6, forged).pass, false);
});
