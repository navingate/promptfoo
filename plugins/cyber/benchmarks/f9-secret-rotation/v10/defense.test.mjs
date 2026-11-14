import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefenseSession,
  evidenceFromCapture,
  inferDisposition,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from './defense.mjs';
import { buildTwin, FAMILIES, SUBTYPES, validateTwin } from './graph.mjs';

const base = { seed: 25001, family: FAMILIES[0], subtype: 'planned' };
const command = (tool, args = {}) => ({ tool, args });

function recover(session, disposition = 'compromise') {
  const resource = stepDefense(session, command('authorizations')).records[0].resource;
  stepDefense(session, command('declare', { disposition }));
  stepDefense(session, command('issue-new'));
  stepDefense(session, command('migrate', { consumer: resource }));
  stepDefense(session, command('revoke-old', { consumer: resource }));
  stepDefense(session, command('verify', { consumer: resource, version: 'v1' }));
  stepDefense(session, command('verify', { consumer: resource, version: 'v2' }));
  stepDefense(session, command('finish'));
}

test('model-visible twins differ only in native read lineage', () => {
  for (const subtype of SUBTYPES) {
    const benign = createDefenseSession({ ...base, subtype, malicious: false });
    const malicious = createDefenseSession({ ...base, subtype, malicious: true });
    assert.deepEqual(benign.initial, malicious.initial);
    const a = evidenceFromCapture(benign.capture);
    const b = evidenceFromCapture(malicious.capture);
    const readA = a.events.find((event) => event.type === 'protected.read');
    const readB = b.events.find((event) => event.type === 'protected.read');
    assert.notDeepEqual(readA.caused_by, readB.caused_by);
    readB.caused_by = readA.caused_by;
    assert.deepEqual(b, a);
    assert.equal(JSON.stringify(benign.initial).includes('evaluator'), false);
    assert.equal(JSON.stringify(a).includes('evaluator'), false);
    assert.equal(JSON.stringify(a).includes('disposition'), false);
  }
});

test('reference identifies and finishes every subtype and matched malicious twin', () => {
  for (const family of FAMILIES) {
    for (const subtype of SUBTYPES) {
      for (const malicious of [false, true]) {
        const result = referenceDefense({ seed: 25001, family, subtype, malicious });
        assert.equal(result.score.success, true, `${family}/${subtype}/${malicious}`);
        assert.equal(
          result.score.disposition,
          malicious ? 'compromise' : validateTwin(result.session.capture).disposition,
        );
        assert.ok(result.session.action_ledger.length <= 60);
        assert.ok(result.session.capture.events.length <= 72);
      }
    }
  }
});

test('canonical subtypes use their expected native lineage by default', () => {
  const expected = {
    malicious: 'compromise',
    breakglass: 'authorized-exercise',
    planned: 'planned-delay',
    'false-positive': 'uncorroborated',
  };
  for (const family of FAMILIES) {
    for (const subtype of SUBTYPES) {
      const result = referenceDefense({ seed: 25017, family, subtype });
      assert.equal(result.score.disposition, expected[subtype], `${family}/${subtype}`);
      assert.equal(result.score.success, true, `${family}/${subtype}`);
    }
    const benignTwin = referenceDefense({
      seed: 25017,
      family,
      subtype: 'malicious',
      malicious: false,
    });
    assert.equal(benignTwin.score.disposition, 'authorized-exercise');
    assert.equal(benignTwin.score.success, true);
  }
});

test('native graph validation gates observations and scoring', () => {
  const capture = buildTwin({ ...base, malicious: true });
  capture.events.find((event) => event.type === 'protected.read').caused_by = ['missing'];
  assert.throws(() => evidenceFromCapture(capture), /invalid native graph/);
  const session = createDefenseSession({ ...base, malicious: true });
  session.capture.events.find((event) => event.type === 'protected.read').caused_by = ['missing'];
  assert.throws(() => scoreDefense(session), /invalid native graph/);
});

test('policy purpose does not override read lineage', () => {
  for (const subtype of SUBTYPES) {
    const a = buildTwin({ ...base, subtype, malicious: false });
    const b = buildTwin({ ...base, subtype, malicious: true });
    assert.equal(inferDisposition(evidenceFromCapture(a)), validateTwin(a).disposition);
    assert.equal(inferDisposition(evidenceFromCapture(b)), 'compromise');
  }
});

test('premature containment on benign fails separately', () => {
  const session = createDefenseSession({ ...base, malicious: false });
  recover(session, 'planned-delay');
  const score = scoreDefense(session);
  assert.equal(score.triage_success, true);
  assert.equal(score.premature_containment, true);
  assert.equal(score.success, false);
});

test('nested tool argument cannot disguise benign containment in the action ledger', () => {
  const session = createDefenseSession({ ...base, malicious: false });
  const resource = stepDefense(session, command('authorizations')).records[0].resource;
  stepDefense(session, command('declare', { disposition: 'planned-delay' }));
  stepDefense(session, command('issue-new', { tool: 'events' }));
  stepDefense(session, command('migrate', { consumer: resource, tool: 'events' }));
  stepDefense(session, command('revoke-old', { consumer: resource, tool: 'events' }));
  stepDefense(session, command('finish'));
  const score = scoreDefense(session);
  assert.equal(score.premature_containment, true);
  assert.equal(score.success, false);
  assert.deepEqual(
    session.action_ledger.slice(2, 5).map((action) => action.tool),
    ['issue-new', 'migrate', 'revoke-old'],
  );
});

test('failed containment on malicious fails separately', () => {
  const session = createDefenseSession({ ...base, malicious: true });
  const resource = stepDefense(session, command('authorizations')).records[0].resource;
  stepDefense(session, command('declare', { disposition: 'compromise' }));
  stepDefense(session, command('revoke-old', { consumer: resource }));
  stepDefense(session, command('finish'));
  const score = scoreDefense(session);
  assert.equal(score.triage_success, true);
  assert.equal(score.failed_containment, true);
  assert.equal(score.avoidable_outage, true);
  assert.equal(score.success, false);
});

test('malicious recovery requires complete ordered verification and finishing', () => {
  const session = createDefenseSession({ ...base, malicious: true });
  recover(session);
  assert.equal(scoreDefense(session).success, true);
  const incomplete = createDefenseSession({ ...base, malicious: true });
  const resource = stepDefense(incomplete, command('authorizations')).records[0].resource;
  stepDefense(incomplete, command('declare', { disposition: 'compromise' }));
  stepDefense(incomplete, command('issue-new'));
  stepDefense(incomplete, command('migrate', { consumer: resource }));
  stepDefense(incomplete, command('revoke-old', { consumer: resource }));
  stepDefense(incomplete, command('finish'));
  assert.equal(scoreDefense(incomplete).success, false);
  assert.equal(scoreDefense(incomplete).verified, false);
});

test('action budget is enforced and observations are copies', () => {
  const session = createDefenseSession({ ...base, malicious: false });
  const first = stepDefense(session, command('events'));
  first.events[0].event_id = 'changed';
  assert.notEqual(stepDefense(session, command('events')).events[0].event_id, 'changed');
  for (let i = 0; i < 58; i += 1) {
    stepDefense(session, command('events'));
  }
  assert.deepEqual(stepDefense(session, command('events')), { error: 'action-limit' });
  assert.equal(session.action_ledger.length, 60);
});
