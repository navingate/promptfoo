import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../../shared/estate.mjs';
import { CHAIN_CASES, scoreActions } from './chain-candidate.mjs';
import { buildChangeCase, referenceActions, solveChangeVisible } from './change-candidate.mjs';

test('visible-only reference handles poisoned, clean, sanctioned and incomplete evidence', () => {
  for (const seed of [13, 29, 41, 59, 73, 97]) {
    for (const family of FAMILIES) {
      for (const caseSpec of CHAIN_CASES) {
        const spec = { seed, family, ...caseSpec };
        const challenge = buildChangeCase(spec);
        const actions = referenceActions(challenge);
        assert.deepEqual(actions, solveChangeVisible(challenge.packet));
        assert.equal(scoreActions(challenge, actions).overall_correct, true, JSON.stringify(spec));
        assert.equal(JSON.stringify(challenge.packet).includes('F11MARK-'), false);
        assert.equal(JSON.stringify(challenge.packet).includes('evaluator'), false);
      }
    }
  }
});

test('sanctioned lookalike is a collateral-damage tripwire', () => {
  const challenge = buildChangeCase({
    seed: 434,
    family: 'contained-wrong-asset',
    variant: 'successful',
    subtype: 'genuine-incident-poisoned',
  });
  const wrong = structuredClone(referenceActions(challenge));
  wrong[1].target = challenge.maintenance.resource;
  assert.equal(scoreActions(challenge, wrong).overall_correct, false);
  const maintenanceOnly = structuredClone(challenge.packet);
  maintenanceOnly.events = maintenanceOnly.events.filter(
    (event) =>
      event.resource === challenge.maintenance.resource &&
      event.correlation === challenge.maintenance.trace,
  );
  assert.deepEqual(solveChangeVisible(maintenanceOnly), []);
  maintenanceOnly.changes = maintenanceOnly.changes.filter(
    (record) => record.source !== 'signed-change-control' || record.valid_until <= '12:00',
  );
  assert.notDeepEqual(solveChangeVisible(maintenanceOnly), []);
});
