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
    const observedOnly = structuredClone(ref);
    observedOnly.actions[0] = {
      tool: 'revoke_session',
      target: instance.events.find((event) => event.actor !== instance.events[0].actor)?.actor,
      citations: [instance.events.at(-1).event_id],
    };
    const observedVerdict = calibrationScore(instance, observedOnly);
    assert.equal(observedVerdict.outcome, 'fail');
    assert.equal(observedVerdict.metrics.actor_progress.length > 0, true);
    if (stage !== 'terminal-unrecoverable') {
      const wrongPoint = structuredClone(ref);
      const otherPoint = instance.recovery_graph.recovery_points.find(
        (point) => point.id !== ref.actions.find((a) => a.tool === 'seal_point').target,
      );
      wrongPoint.actions.find((a) => a.tool === 'seal_point').target = otherPoint.id;
      assert.equal(calibrationScore(instance, wrongPoint).outcome, 'fail');
    }
    const noCitation = structuredClone(ref);
    noCitation.actions[0].citations = [];
    assert.equal(calibrationScore(instance, noCitation).outcome, 'fail');
    if (stage !== 'terminal-unrecoverable') {
      const delayed = structuredClone(ref);
      delayed.actions.unshift({
        tool: 'verify_change',
        target: instance.authorizations[0].record_id,
        citations: [instance.authorizations[0].record_id],
      });
      const scored = calibrationScore(instance, delayed);
      assert.equal(scored.outcome, 'fail');
      assert.equal(scored.metrics.actor_progress.length > 0, true);
    }
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
  const drVerify = structuredClone(calibrationReference(benign));
  drVerify.actions.splice(1, 0, {
    tool: 'verify_recovery',
    target: null,
    citations: [benign.events.at(-1).event_id],
  });
  assert.equal(calibrationScore(benign, drVerify).outcome, 'pass');
  const malicious = calibrationInstance({
    seed: 13,
    family: 'disabled-kms-key',
    subtype: 'malicious-sabotage',
  });
  const prematureClose = structuredClone(calibrationReference(malicious));
  prematureClose.actions.pop();
  prematureClose.actions.push({
    tool: 'close_case',
    target: null,
    citations: [malicious.events.at(-1).event_id],
  });
  assert.equal(calibrationScore(malicious, prematureClose).outcome, 'fail');
  const rpoCase = calibrationInstance({
    seed: 12,
    family: 'disabled-kms-key',
    subtype: 'malicious-sabotage',
  });
  const older = structuredClone(calibrationReference(rpoCase));
  older.actions.find((a) => a.tool === 'seal_point').target =
    rpoCase.recovery_graph.recovery_points[1].id;
  assert.equal(calibrationScore(rpoCase, older).outcome, 'fail');
});
