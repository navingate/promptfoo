import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from '../v30/producer.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import {
  buildCohortCatalog,
  extractCohortCandidates,
  selectorKey,
  solveCohortCover,
} from './cohorts.mjs';

const job = (id) => ({ kind: 'job', id });
const session = (id) => ({ kind: 'session', id });
const pause = (id) => ({ tool: 'pause-job', args: { job_uid: id } });
const deny = (role, name) => ({
  tool: 'deny-role-session',
  args: { role_arn: role, role_session_name: name },
});
const cohort = (cohort_id, selectors) => ({ cohort_id, selectors });
const action = (cohort_id) => ({ tool: 'quarantine-cohort', args: { cohort_id } });

function sampleCatalog() {
  return {
    candidates: [job('j1'), job('j2'), job('j3'), job('j4'), session('s1'), session('s2')],
    cohorts: [
      cohort('a', [job('j1'), session('s1'), job('j4')]),
      cohort('b', [session('s1'), job('j2')]),
      cohort('c', [session('s2'), job('j4')]),
      cohort('unsafe', [job('j1'), job('j3'), session('s2')]),
    ],
  };
}

function sampleCurrent() {
  return new Map([
    [selectorKey(job('j1')), pause('j1')],
    [selectorKey(job('j2')), pause('j2')],
    [selectorKey(job('j3')), pause('j3')],
    [selectorKey(session('s1')), deny('arn:role/a', 'issued-s1')],
    [selectorKey(session('s2')), deny('arn:role/b', 'issued-s2')],
  ]);
}

test('selector keys distinguish kinds and reject malformed selectors', () => {
  assert.equal(selectorKey(job('same')), 'job:same');
  assert.equal(selectorKey(session('same')), 'session:same');
  assert.notEqual(selectorKey(job('same')), selectorKey(session('same')));
  for (const bad of [{ kind: 'credential', id: 'x' }, { kind: 'job', id: '' }, null]) {
    assert.throws(() => selectorKey(bad), /selector/);
  }
});

test('candidate extraction reads every indexed Job and session ID once', () => {
  const visible = buildEpisode({ seed: 98000, family: FAMILIES[0] }).visible;
  const index = listWorkloads(visible);
  const candidates = extractCohortCandidates(index);
  assert.equal(candidates.length, 48);
  assert.equal(new Set(candidates.map(selectorKey)).size, 48);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.kind === 'job').map((candidate) => candidate.id),
    index.job_uids,
  );
  assert.deepEqual(
    candidates.filter((candidate) => candidate.kind === 'session').map((candidate) => candidate.id),
    index.access_key_refs,
  );
  assert.throws(
    () =>
      extractCohortCandidates({
        ...index,
        job_uids: [...index.job_uids.slice(0, -1), index.job_uids[0]],
      }),
    /duplicate/,
  );
  assert.throws(() => extractCohortCandidates({ ...index, access_key_refs: [] }), /24/);
});

test('catalog has 96 opaque shuffled groups of two to four with uniform candidate frequency', () => {
  const index = listWorkloads(buildEpisode({ seed: 98000, family: FAMILIES[0] }).visible);
  const catalog = buildCohortCatalog(index, {
    pairSeed: 98000,
    family: FAMILIES[0],
    nonce: 7,
  });
  assert.equal(catalog.candidates.length, 48);
  assert.equal(catalog.cohorts.length, 96);
  assert.equal(new Set(catalog.cohorts.map((item) => item.cohort_id)).size, 96);
  const frequency = new Map(catalog.candidates.map((candidate) => [selectorKey(candidate), 0]));
  for (const group of catalog.cohorts) {
    assert.match(group.cohort_id, /^cohort-[a-f0-9]{20}$/u);
    assert.deepEqual(Object.keys(group).sort(), ['cohort_id', 'selectors']);
    assert.ok(group.selectors.length >= 2 && group.selectors.length <= 4);
    assert.equal(new Set(group.selectors.map(selectorKey)).size, group.selectors.length);
    for (const member of group.selectors) {
      assert.deepEqual(Object.keys(member).sort(), ['id', 'kind']);
      const key = selectorKey(member);
      assert.ok(frequency.has(key));
      frequency.set(key, frequency.get(key) + 1);
    }
  }
  assert.deepEqual(new Set(frequency.values()), new Set([6]));
  assert.equal(/"(?:current|approved|unsafe|safe)"/u.test(JSON.stringify(catalog)), false);
});

test('catalog is stable across an even/odd pair and changes with nonce', () => {
  for (const family of FAMILIES) {
    const even = listWorkloads(buildEpisode({ seed: 98000, family }).visible);
    const odd = listWorkloads(buildEpisode({ seed: 98001, family }).visible);
    const options = { pairSeed: 98000, family, nonce: 3 };
    assert.deepEqual(buildCohortCatalog(even, options), buildCohortCatalog(odd, options));
    assert.notDeepEqual(
      buildCohortCatalog(even, options),
      buildCohortCatalog(even, { ...options, nonce: 4 }),
    );
  }
});

test('solver treats archive selectors as neutral and rejects approved current controls', () => {
  const current = sampleCurrent();
  const required = [pause('j1'), deny('arn:role/a', 'issued-s1'), deny('arn:role/b', 'issued-s2')];
  assert.deepEqual(solveCohortCover(sampleCatalog(), current, required, { maxActions: 2 }), [
    action('a'),
    action('c'),
  ]);
  assert.deepEqual(
    solveCohortCover(
      {
        candidates: sampleCatalog().candidates,
        cohorts: [cohort('unsafe', [job('j1'), job('j3')])],
      },
      current,
      [pause('j1')],
      { maxActions: 1 },
    ),
    [pause('j1')],
  );
});

test('solver handles overlapping cohorts and returns null beyond the action budget', () => {
  const catalog = sampleCatalog();
  const current = sampleCurrent();
  const required = [
    pause('j1'),
    pause('j2'),
    deny('arn:role/a', 'issued-s1'),
    deny('arn:role/b', 'issued-s2'),
  ];
  assert.equal(solveCohortCover(catalog, current, required, { maxActions: 2 }), null);
  assert.deepEqual(solveCohortCover(catalog, current, required, { maxActions: 3 }), [
    action('a'),
    action('b'),
    action('c'),
  ]);
  assert.deepEqual(solveCohortCover(catalog, current, [], { maxActions: 0 }), []);
});

test('solver gives deterministic shortest solutions with individual controls available', () => {
  const catalog = sampleCatalog();
  const current = sampleCurrent();
  const required = [pause('j1'), deny('arn:role/a', 'issued-s1')];
  const first = solveCohortCover(catalog, current, required, { maxActions: 7 });
  assert.deepEqual(first, [action('a')]);
  assert.deepEqual(
    solveCohortCover(catalog, current, [...required].reverse(), { maxActions: 7 }),
    first,
  );
  assert.deepEqual(
    solveCohortCover({ candidates: catalog.candidates, cohorts: [] }, current, required),
    [deny('arn:role/a', 'issued-s1'), pause('j1')],
  );
});

test('solver rejects duplicate and unknown catalog members and invalid required controls', () => {
  const current = sampleCurrent();
  const required = [pause('j1')];
  const base = sampleCatalog();
  assert.throws(
    () =>
      solveCohortCover(
        { ...base, cohorts: [cohort('duplicate', [job('j1'), job('j1')])] },
        current,
        required,
      ),
    /duplicate/,
  );
  assert.throws(
    () =>
      solveCohortCover(
        { ...base, cohorts: [cohort('unknown', [job('j1'), job('missing')])] },
        current,
        required,
      ),
    /unknown/,
  );
  assert.throws(
    () =>
      solveCohortCover({ ...base, candidates: [...base.candidates, job('j1')] }, current, required),
    /duplicate/,
  );
  assert.throws(
    () =>
      solveCohortCover({ ...base, cohorts: [...base.cohorts, base.cohorts[0]] }, current, required),
    /duplicate/,
  );
  assert.throws(() => solveCohortCover(base, current, [pause('outside')]), /required/);
  assert.throws(
    () => solveCohortCover(base, new Map([['job:outside', pause('outside')]]), required),
    /current/,
  );
});

test('solver rejects required controls beyond its bitmask capacity', () => {
  const candidates = Array.from({ length: 31 }, (_, index) => job(`j${index}`));
  const current = new Map(
    candidates.map((candidate) => [selectorKey(candidate), pause(candidate.id)]),
  );
  assert.throws(
    () => solveCohortCover({ candidates, cohorts: [] }, current, [...current.values()]),
    /too many required/,
  );
});
