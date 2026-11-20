import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV30Episode } from '../v30/producer.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import { solveMixedCover, solveNoExceptionCover, validateCoupledCatalog } from './catalog.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const cache = new Map();
function episode(seed, family) {
  const key = `${seed}|${family}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      buildEpisode(
        { seed, family },
        { catalogKey: process.env.F3_V35_CATALOG_KEY ?? '01'.repeat(32) },
      ),
    );
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

function assertPublicTripleCounts(catalogs, current) {
  const six = catalogs.containment_cohorts.cohorts
    .map((group) => group.selectors.map((s) => `${s.kind}:${s.id}`).filter((k) => current.has(k)))
    .filter((keys) => keys.length === 6);
  assert.equal(six.length, 12);
  const incidence = new Map(six.map((group) => [group, 0]));
  let count = 0;
  for (const [i, first] of six.entries()) {
    for (let j = i + 1; j < six.length; j++) {
      for (const third of six.slice(j + 1)) {
        const triple = [first, six[j], third];
        const union = new Set(triple.flat());
        if (union.size !== 18) {
          continue;
        }
        count++;
        for (const group of triple) {
          incidence.set(group, incidence.get(group) + 1);
        }
        assert.ok(
          six.every((group) => group.some((key) => union.has(key))),
          'a fourth six-current control completes the public partition',
        );
      }
    }
  }
  assert.equal(count, 64);
  assert.ok([...incidence.values()].every((n) => n === 16));
}

test('all development pairs expose the same 64-way structural ambiguity and admit a native four-request solution', () => {
  for (let pairSeed = 109000; pairSeed < 109012; pairSeed += 2) {
    for (const family of FAMILIES) {
      const even = episode(pairSeed, family);
      const odd = buildV30Episode({ seed: pairSeed + 1, family });
      const catalogs = visibleCatalogs(even);
      assertPublicTripleCounts(catalogs, currentActions(even));
      for (const variant of [even, odd]) {
        const current = currentActions(variant);
        const required = requiredActions(variant);
        const unsafeActions = new Set(required.map((action) => JSON.stringify(action)));
        const unsafe = new Set(
          [...current]
            .filter(([, action]) => unsafeActions.has(JSON.stringify(action)))
            .map(([key]) => key),
        );
        const plan = solveMixedCover(catalogs, current, required);
        assert.ok(plan, `${pairSeed}/${family}: visible reference`);
        assert.equal(plan.length, 4);
        assert.equal(
          replayContainment({ ...variant.native, ...catalogs, action_budget: 4 }, plan).success,
          true,
        );
        const allSafe = catalogs.containment_cohorts.cohorts.filter((group) => {
          const selected = group.selectors
            .map((selector) => `${selector.kind}:${selector.id}`)
            .filter((key) => current.has(key));
          return selected.length === 6 && selected.every((key) => !unsafe.has(key));
        });
        assert.equal(allSafe.length, 0, `${pairSeed}/${family}: all-safe Q6 marker`);
      }
    }
  }
});

test('paired V35 episodes expose identical catalogs and share their retimed evidence schedule', () => {
  const even = episode(109000, FAMILIES[0]);
  const odd = episode(109001, FAMILIES[0]);
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

test('V35 preserves V32 native chain and visible incident outside containment catalogs and schedule windows', () => {
  const spec = { seed: 109000, family: FAMILIES[0] };
  const v32 = buildV32Episode(spec);
  const v35 = episode(spec.seed, spec.family);
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
  } = v35.native;
  assert.ok(oldNativeCatalog && newNativeCatalog && nativeExceptions);
  assert.equal(oldBudget, 7);
  assert.equal(newBudget, 4);
  assert.deepEqual(newNative, oldNative);
  const {
    containment_cohorts: oldVisibleCatalog,
    query_access_schedule: oldSchedule,
    ...oldVisible
  } = v32.visible;
  const {
    containment_cohorts: newVisibleCatalog,
    exception_bundles: visibleExceptions,
    query_access_schedule: newSchedule,
    ...newVisible
  } = v35.visible;
  assert.ok(oldVisibleCatalog && newVisibleCatalog && visibleExceptions);
  assert.notDeepEqual(newSchedule, oldSchedule);
  assert.deepEqual(newVisible, oldVisible);
  const sessions = new Map(v35.native.sessions.map((item) => [item.access_key_ref, item]));
  for (const item of v35.visible.session_register) {
    const native = sessions.get(item.access_key_ref);
    assert.equal(item.role_arn, native.role_arn);
    assert.equal(item.role_session_name, native.role_session_name);
  }
});

test('all three settings have visible four-request paired plans and no exception-free plan', () => {
  for (const family of FAMILIES) {
    const even = episode(109000, family);
    const odd = episode(109001, family);
    const plans = [];
    for (const produced of [even, odd]) {
      const current = currentActions(produced);
      const required = requiredActions(produced);
      const catalogs = visibleCatalogs(produced);
      assert.equal(current.size, 24);
      assert.equal(solveNoExceptionCover(catalogs, current, required), null);
      assert.equal(solveMixedCover(catalogs, current, required, { maxActions: 3 }), null);
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
      for (let omitted = 0; omitted < plan.length; omitted += 1) {
        const shorter = plan.filter((_, index) => index !== omitted);
        assert.equal(
          replayContainment(produced.native, shorter).success,
          false,
          `${family}: native replay rejects three-request plan missing action ${omitted}`,
        );
      }
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
  for (const produced of [episode(109000, FAMILIES[0]), episode(109001, FAMILIES[0])]) {
    for (const role_arn of new Set(produced.native.sessions.map((session) => session.role_arn))) {
      const replay = replayContainment(produced.native, [
        { tool: 'revoke-role-sessions', args: { role_arn } },
      ]);
      assert.ok(replay.blocked_approved_attempt_count > 0);
      assert.equal(replay.success, false);
    }
  }
});

test('V35 producer rejects malformed specifications', () => {
  assert.throws(() => buildEpisode({ seed: -1, family: FAMILIES[0] }), /seed/iu);
  assert.throws(() => buildEpisode({ seed: 109000, family: '' }), /family/iu);
});
