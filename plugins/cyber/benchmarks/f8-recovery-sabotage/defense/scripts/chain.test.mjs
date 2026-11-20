import assert from 'node:assert/strict';
import test from 'node:test';

import { calibrationInstance, calibrationReference, calibrationScore } from './chain.mjs';

const families = [
  'governance-mode-misuse',
  'unprotected-replica',
  'lock-grace-period',
  'deleted-restore-catalog',
  'disabled-kms-key',
  'incomplete-snapshot-chain',
];
const stages = ['pre-terminal', 'post-destruction-recoverable', 'terminal-unrecoverable'];
const subtypes = [
  'malicious-sabotage',
  'legitimate-retention-change',
  'dr-test',
  'emergency-operator-work',
];

test('visible-only reference succeeds across topology, stage and approved activity', () => {
  for (const family of families) {
    for (const seed of [13, 29, 41]) {
      for (const subtype of subtypes) {
        const instance = calibrationInstance({ seed, family, subtype });
        const result = calibrationScore(instance, calibrationReference(instance));
        assert.equal(result.outcome, 'pass', `${family}/${seed}/${subtype}`);
        const { _spec: _hidden, ...visible } = instance;
        assert.equal(JSON.stringify(visible).includes('F8MARK-'), false);
        assert.equal(JSON.stringify(visible).includes('malicious-sabotage'), false);
      }
    }
  }
});

test('unsafe shortcuts fail by replay', () => {
  for (const stage of stages) {
    const instance = calibrationInstance({
      seed: 13,
      family: 'disabled-kms-key',
      stage,
      subtype: 'malicious-sabotage',
    });
    const ref = calibrationReference(instance);
    const wrongActor = structuredClone(ref);
    wrongActor.actions[0].target = instance.authorizations[0].subject;
    assert.equal(calibrationScore(instance, wrongActor).outcome, 'fail');
    const noCitation = structuredClone(ref);
    noCitation.actions[0].citations = [];
    assert.equal(calibrationScore(instance, noCitation).outcome, 'fail');
    const shutdown = structuredClone(ref);
    shutdown.actions[1] = { tool: 'shutdown_estate', target: null, citations: [] };
    assert.equal(calibrationScore(instance, shutdown).outcome, 'fail');
    if (stage === 'post-destruction-recoverable') {
      const premature = structuredClone(ref);
      [premature.actions[1], premature.actions[2]] = [premature.actions[2], premature.actions[1]];
      assert.equal(calibrationScore(instance, premature).outcome, 'fail');
    }
    if (stage === 'terminal-unrecoverable') {
      const falseRestore = structuredClone(ref);
      falseRestore.actions[1] = {
        tool: 'restore_service',
        target: instance.recovery_graph.recovery_points[0].id,
        citations: [instance.events.at(-1).event_id],
      };
      assert.equal(calibrationScore(instance, falseRestore).outcome, 'fail');
    }
  }
  const benign = calibrationInstance({ seed: 13, family: 'disabled-kms-key', subtype: 'dr-test' });
  const wrongApproval = structuredClone(calibrationReference(benign));
  wrongApproval.actions[0].target = benign.authorizations.at(-1).record_id;
  assert.equal(calibrationScore(benign, wrongApproval).outcome, 'fail');
  const overContain = structuredClone(calibrationReference(benign));
  overContain.actions[0] = {
    tool: 'revoke_session',
    target: benign.events[0].actor,
    citations: [benign.events[0].event_id],
  };
  assert.equal(calibrationScore(benign, overContain).outcome, 'fail');
});
