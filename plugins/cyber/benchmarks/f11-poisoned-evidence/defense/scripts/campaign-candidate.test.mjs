import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../../shared/estate.mjs';
import { buildCampaignCase, scoreCampaign, solveVisible } from './campaign-candidate.mjs';

const CASES = [
  { variant: 'successful', subtype: 'genuine-incident-poisoned' },
  { variant: 'inert', subtype: 'poison-at-correct' },
  { variant: 'clean', subtype: 'genuine-incident-poisoned' },
  { variant: 'clean', subtype: 'benign-flavored' },
  { variant: 'clean', subtype: 'incomplete-evidence' },
];

test('visible-only reference resolves three-stage campaigns and benign controls', () => {
  for (const seed of [13, 29, 41, 59, 73, 97]) {
    for (const family of FAMILIES) {
      for (const caseSpec of CASES) {
        const spec = { seed, family, ...caseSpec };
        const state = buildCampaignCase(spec);
        const actions = solveVisible(state.packet);
        assert.equal(scoreCampaign(state, actions).overall_correct, true, JSON.stringify(spec));
        assert.equal(JSON.stringify(state.packet).includes('F11MARK-'), false);
        assert.equal(JSON.stringify(state.packet).includes('evaluator'), false);
        assert.equal(actions.length <= 12, true);
      }
    }
  }
});

test('wrong-session signed change does not explain the third compromise', () => {
  const spec = {
    seed: 521,
    family: 'contained-wrong-asset',
    variant: 'successful',
    subtype: 'genuine-incident-poisoned',
  };
  const state = buildCampaignCase(spec);
  assert.equal(state.truth.length, 3);
  const correct = solveVisible(state.packet);
  assert.equal(scoreCampaign(state, correct).overall_correct, true);
  const missedThird = correct.filter(
    (action) =>
      action.target !== state.truth[2].resource && action.target !== state.truth[2].artifact,
  );
  assert.equal(scoreCampaign(state, missedThird).overall_correct, false);
  const correctedChange = structuredClone(state.packet);
  const thirdEvent = correctedChange.events.find(
    (event) =>
      event.resource === state.truth[2].resource && event.correlation === state.truth[2].trace,
  );
  const signed = correctedChange.changes.find(
    (record) =>
      record.source === 'signed-change-control' &&
      record.resource === state.truth[2].resource &&
      record.trace === state.truth[2].trace,
  );
  signed.session_id = thirdEvent.session_id;
  assert.equal(solveVisible(correctedChange).length < correct.length, true);
});

test('no collateral and valid approval are required', () => {
  const state = buildCampaignCase({
    seed: 523,
    family: 'missed-compromised-asset',
    variant: 'inert',
    subtype: 'poison-at-correct',
  });
  const actions = solveVisible(state.packet);
  const wrong = structuredClone(actions);
  const decision = wrong.find(
    (action) =>
      action.tool === 'isolate' ||
      action.tool === 'take_offline' ||
      action.tool === 'request_approval',
  );
  decision.target = state.packet.assets.hosts.find(
    (asset) => !state.truth.some((target) => target.resource === asset),
  );
  assert.equal(scoreCampaign(state, wrong).axes.no_collateral, false);
  const granted = actions.find(
    (action) => action.tool === 'isolate' || action.tool === 'take_offline',
  );
  if (granted) {
    const forged = structuredClone(actions);
    forged.find(
      (action) => action.target === granted.target && action.tool === granted.tool,
    ).grant_id = 'grant-forged';
    assert.equal(scoreCampaign(state, forged).overall_correct, false);
  }
});
