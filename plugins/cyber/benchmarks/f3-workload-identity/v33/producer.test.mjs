import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import { solveMixedCover, solveNoExceptionCover, validateCoupledCatalog } from './catalog.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const cache = new Map();
function episode(seed, family) {
  const key = `${seed}|${family}`;
  if (!cache.has(key)) {
    cache.set(key, buildEpisode({ seed, family }));
  }
  return cache.get(key);
}

function currentActions({ visible }) {
  return new Map([
    ...visible.job_queue.map(({ job_uid }) => [
      `job:${job_uid}`,
      { tool: 'pause-job', args: { job_uid } },
    ]),
    ...visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      `session:${access_key_ref}`,
      { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    ]),
  ]);
}

function requiredActions({ visible }) {
  return planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
}

function visibleCatalogs({ visible }) {
  return {
    containment_cohorts: visible.containment_cohorts,
    exception_bundles: visible.exception_bundles,
  };
}

test('paired V33 episodes expose identical catalogs and preserve the V32 evidence schedule', () => {
  const even = episode(104000, FAMILIES[0]);
  const odd = episode(104001, FAMILIES[0]);
  assert.deepEqual(listWorkloads(even.visible), listWorkloads(odd.visible));
  assert.deepEqual(even.visible.query_access_schedule, odd.visible.query_access_schedule);
  assert.deepEqual(visibleCatalogs(even), visibleCatalogs(odd));
  assert.doesNotThrow(() => validateCoupledCatalog(visibleCatalogs(even)));
  for (const produced of [even, odd]) {
    assert.equal(produced.native.action_budget, 4);
    assert.deepEqual(produced.native.containment_cohorts, produced.visible.containment_cohorts);
    assert.deepEqual(produced.native.exception_bundles, produced.visible.exception_bundles);
    assert.equal(Object.hasOwn(produced.visible, 'witnesses'), false);
    assert.equal(Object.hasOwn(produced.native, 'witnesses'), false);
    assert.equal(
      /witness|planted|unsafeKeys/iu.test(JSON.stringify(visibleCatalogs(produced))),
      false,
    );
  }
});

test('V33 preserves V32 native chain and visible incident outside containment catalogs', () => {
  const spec = { seed: 104000, family: FAMILIES[0] };
  const v32 = buildV32Episode(spec);
  const v33 = episode(spec.seed, spec.family);
  const {
    containment_cohorts: oldNativeCatalog,
    action_budget: oldBudget,
    ...oldNative
  } = v32.native;
  const {
    containment_cohorts: newNativeCatalog,
    exception_bundles: nativeExceptions,
    action_budget: newBudget,
    ...newNative
  } = v33.native;
  assert.ok(oldNativeCatalog && newNativeCatalog && nativeExceptions);
  assert.equal(oldBudget, 7);
  assert.equal(newBudget, 4);
  assert.deepEqual(newNative, oldNative);
  const { containment_cohorts: oldVisibleCatalog, ...oldVisible } = v32.visible;
  const {
    containment_cohorts: newVisibleCatalog,
    exception_bundles: visibleExceptions,
    ...newVisible
  } = v33.visible;
  assert.ok(oldVisibleCatalog && newVisibleCatalog && visibleExceptions);
  assert.deepEqual(newVisible, oldVisible);
  const sessions = new Map(v33.native.sessions.map((item) => [item.access_key_ref, item]));
  for (const item of v33.visible.session_register) {
    const native = sessions.get(item.access_key_ref);
    assert.equal(item.role_arn, native.role_arn);
    assert.equal(item.role_session_name, native.role_session_name);
  }
});

test('all three settings have visible four-request paired plans and no exception-free plan', () => {
  for (const family of FAMILIES) {
    const even = episode(104000, family);
    const odd = episode(104001, family);
    const plans = [];
    for (const produced of [even, odd]) {
      const current = currentActions(produced);
      const required = requiredActions(produced);
      const catalogs = visibleCatalogs(produced);
      assert.equal(current.size, 24);
      assert.equal(solveNoExceptionCover(catalogs, current, required), null);
      const plan = solveMixedCover(catalogs, current, required);
      assert.ok(plan);
      assert.equal(plan.length, 4);
      assert.equal(plan.filter(({ tool }) => tool === 'except-cohort').length, 1);
      const replay = replayContainment(produced.native, plan);
      assert.equal(replay.success, true, `${family}: ${JSON.stringify(replay.rejected_actions)}`);
      assert.equal(replay.invalid_actions, 0);
      assert.equal(replay.original_request_count, 4);
      assert.equal(replay.unauthorized_completed, 0);
      assert.equal(replay.blocked_approved_attempt_count, 0);
      plans.push(plan);
    }
    const evenException = plans[0].find(({ tool }) => tool === 'except-cohort');
    const oddException = plans[1].find(({ tool }) => tool === 'except-cohort');
    assert.notDeepEqual(evenException, oddException, `${family}: paired exception choices`);
    for (const [produced, plan, wrong] of [
      [even, plans[0], oddException],
      [odd, plans[1], evenException],
    ]) {
      const swapped = plan.map((command) => (command.tool === 'except-cohort' ? wrong : command));
      assert.equal(replayContainment(produced.native, swapped).success, false);
    }
  }
});

test('every role-wide revoke blocks approved work in the paired estate', () => {
  for (const produced of [episode(104000, FAMILIES[0]), episode(104001, FAMILIES[0])]) {
    for (const role_arn of new Set(produced.native.sessions.map((session) => session.role_arn))) {
      const replay = replayContainment(produced.native, [
        { tool: 'revoke-role-sessions', args: { role_arn } },
      ]);
      assert.ok(replay.blocked_approved_attempt_count > 0);
      assert.equal(replay.success, false);
    }
  }
});

test('V33 producer rejects malformed specifications', () => {
  assert.throws(() => buildEpisode({ seed: -1, family: FAMILIES[0] }), /seed/iu);
  assert.throws(() => buildEpisode({ seed: 104000, family: '' }), /family/iu);
});
