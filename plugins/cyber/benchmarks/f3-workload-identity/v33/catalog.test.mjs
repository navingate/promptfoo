import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV30Episode } from '../v30/producer.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import {
  buildCoupledCatalog,
  solveMixedCover,
  solveNoExceptionCover,
  validateCoupledCatalog,
} from './catalog.mjs';

const key = ({ kind, id }) => `${kind}:${id}`;

function caseData(seed, family) {
  const episode = buildV30Episode({ seed, family });
  const { visible } = episode;
  const current = new Map([
    ...visible.job_queue.map(({ job_uid }) => [
      `job:${job_uid}`,
      { tool: 'pause-job', args: { job_uid } },
    ]),
    ...visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      `session:${access_key_ref}`,
      { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    ]),
  ]);
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const byAction = new Map(
    [...current].map(([selector, action]) => [JSON.stringify(action), selector]),
  );
  const unsafe = new Set(required.map((action) => byAction.get(JSON.stringify(action))));
  assert.equal(unsafe.has(undefined), false);
  return { episode, index: listWorkloads(visible), current, required, unsafe };
}

function pair(family = FAMILIES[0]) {
  return [caseData(100000, family), caseData(100001, family)];
}

function options(even, odd, nonce = 0, family = FAMILIES[0]) {
  return {
    pairSeed: 100000,
    family,
    nonce,
    currentKeys: new Set(even.current.keys()),
    evenUnsafeKeys: even.unsafe,
    oddUnsafeKeys: odd.unsafe,
  };
}

function blockedFrom(commands, catalogs, current) {
  const q = new Set();
  const e = new Set();
  const p = new Set();
  for (const command of commands) {
    if (command.tool === 'quarantine-cohort') {
      for (const member of catalogs.containment_cohorts.cohorts.find(
        (group) => group.cohort_id === command.args.cohort_id,
      ).selectors) {
        q.add(key(member));
      }
    } else if (command.tool === 'except-cohort') {
      for (const member of catalogs.exception_bundles.bundles.find(
        (group) => group.exception_id === command.args.exception_id,
      ).selectors) {
        e.add(key(member));
      }
    } else {
      const selector = [...current].find(
        ([, action]) => JSON.stringify(action) === JSON.stringify(command),
      );
      assert.ok(selector, 'direct control is current');
      p.add(selector[0]);
    }
  }
  return new Set(
    [...current.keys()].filter(
      (selector) => p.has(selector) || (q.has(selector) && !e.has(selector)),
    ),
  );
}

test('balanced pair-stable catalogs have opaque IDs and no visible witness', () => {
  const [even, odd] = pair();
  const args = options(even, odd, 3);
  const first = buildCoupledCatalog(even.index, args);
  const again = buildCoupledCatalog(odd.index, args);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, buildCoupledCatalog(even.index, { ...args, nonce: 4 }));
  assert.deepEqual(Object.keys(first).sort(), [
    'containment_cohorts',
    'exception_bundles',
    'witnesses',
  ]);
  assert.equal(
    /witness|unsafe|approved|current/iu.test(
      JSON.stringify({
        containment_cohorts: first.containment_cohorts,
        exception_bundles: first.exception_bundles,
      }),
    ),
    false,
  );
  assert.doesNotThrow(() => validateCoupledCatalog(first));
  for (const [catalog, groups, id, size, degree, pattern] of [
    [first.containment_cohorts, 'cohorts', 'cohort_id', 8, 16, /^cohort-[a-f0-9]{20}$/u],
    [first.exception_bundles, 'bundles', 'exception_id', 6, 12, /^exception-[a-f0-9]{20}$/u],
  ]) {
    assert.equal(catalog.candidates.length, 48);
    assert.equal(catalog[groups].length, 96);
    const counts = new Map(catalog.candidates.map((selector) => [key(selector), 0]));
    for (const group of catalog[groups]) {
      assert.match(group[id], pattern);
      assert.equal(group.selectors.length, size);
      assert.equal(new Set(group.selectors.map(key)).size, size);
      for (const selector of group.selectors) {
        counts.set(key(selector), counts.get(key(selector)) + 1);
      }
    }
    assert.deepEqual(new Set(counts.values()), new Set([degree]));
  }
});

test('paired witnesses and visible solver require the corresponding exception', () => {
  const [even, odd] = pair();
  const catalogs = buildCoupledCatalog(even.index, options(even, odd));
  for (const [variant, data, wrong] of [
    ['even', even, 'odd'],
    ['odd', odd, 'even'],
  ]) {
    const witness = catalogs.witnesses[variant];
    assert.equal(witness.length, 4);
    assert.equal(witness.filter((command) => command.tool === 'quarantine-cohort').length, 3);
    assert.equal(witness.filter((command) => command.tool === 'except-cohort').length, 1);
    assert.deepEqual(blockedFrom(witness, catalogs, data.current), data.unsafe);
    const wrongBundle = catalogs.witnesses[wrong].find(
      (command) => command.tool === 'except-cohort',
    );
    assert.notDeepEqual(
      blockedFrom([...witness.slice(0, 3), wrongBundle], catalogs, data.current),
      data.unsafe,
    );
    const planned = solveMixedCover(catalogs, data.current, data.required);
    assert.ok(planned);
    assert.ok(planned.length <= 4);
    assert.deepEqual(blockedFrom(planned, catalogs, data.current), data.unsafe);
    assert.deepEqual(
      solveMixedCover(catalogs, data.current, [...data.required].reverse()),
      planned,
    );
  }
});

test('a deterministic nonce denies every four-request plan without an exception', () => {
  for (const family of FAMILIES) {
    const [even, odd] = pair(family);
    let accepted = null;
    for (let nonce = 0; nonce < 40; nonce += 1) {
      const catalog = buildCoupledCatalog(even.index, options(even, odd, nonce, family));
      if (
        solveNoExceptionCover(catalog, even.current, even.required) === null &&
        solveNoExceptionCover(catalog, odd.current, odd.required) === null
      ) {
        accepted = catalog;
        break;
      }
    }
    assert.ok(accepted, `${family}: bounded nonce search`);
    assert.equal(solveMixedCover(accepted, even.current, even.required).length, 4);
    assert.equal(solveMixedCover(accepted, odd.current, odd.required).length, 4);
    assert.equal(solveMixedCover(accepted, even.current, even.required, { maxActions: 3 }), null);
  }
});

test('solver may choose an alternative valid plan and handles empty requirements', () => {
  const [even, odd] = pair();
  const catalog = buildCoupledCatalog(even.index, options(even, odd));
  const one = even.required.slice(0, 1);
  const plan = solveMixedCover(catalog, even.current, one, { maxActions: 1 });
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.deepEqual(
    blockedFrom(plan, catalog, even.current),
    new Set([
      [...even.current].find(([, action]) => JSON.stringify(action) === JSON.stringify(one[0]))[0],
    ]),
  );
  assert.deepEqual(solveMixedCover(catalog, even.current, [], { maxActions: 0 }), []);
  assert.deepEqual(solveNoExceptionCover(catalog, even.current, [], { maxActions: 0 }), []);
});

test('builder rejects malformed paired sets and validation catches catalog corruption', () => {
  const [even, odd] = pair();
  const args = options(even, odd);
  assert.throws(() => buildCoupledCatalog(even.index, { ...args, nonce: -1 }), /nonce/iu);
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, currentKeys: new Set() }),
    /current/iu,
  );
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, oddUnsafeKeys: even.unsafe }),
    /unsafe|flip/iu,
  );
  assert.throws(
    () => buildCoupledCatalog(even.index, { ...args, evenUnsafeKeys: odd.unsafe }),
    /unsafe|flip/iu,
  );
  const catalog = buildCoupledCatalog(even.index, args);
  const bad = structuredClone(catalog);
  bad.containment_cohorts.cohorts[0].selectors[0] = bad.containment_cohorts.cohorts[0].selectors[1];
  assert.throws(() => validateCoupledCatalog(bad), /duplicate/iu);
  const badId = structuredClone(catalog);
  badId.exception_bundles.bundles[0].exception_id = 'exception-leaky';
  assert.throws(() => validateCoupledCatalog(badId), /exception|opaque/iu);
  const badDegree = structuredClone(catalog);
  badDegree.exception_bundles.bundles[0].selectors[0] =
    badDegree.exception_bundles.bundles[1].selectors[0];
  assert.throws(() => validateCoupledCatalog(badDegree), /degree|duplicate/iu);
  assert.throws(
    () => solveMixedCover(catalog, new Map([['job:outside', even.required[0]]]), even.required),
    /current/iu,
  );
  assert.throws(
    () =>
      solveMixedCover(catalog, even.current, [{ tool: 'pause-job', args: { job_uid: 'outside' } }]),
    /required/iu,
  );
  assert.throws(
    () => solveMixedCover(catalog, even.current, even.required, { maxActions: -1 }),
    /maxActions/iu,
  );
});
