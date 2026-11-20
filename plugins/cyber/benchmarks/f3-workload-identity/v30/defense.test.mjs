import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { listWorkloads as listCoreWorkloads } from '../v22/queries.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV29Episode } from '../v29/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { resolveIndex } from './ledger.mjs';
import { buildEpisode } from './producer.mjs';
import { listWorkloads } from './queries.mjs';

test('v30 index has sixty queryable IDs but only thirty effective in-horizon IDs', () => {
  for (const family of FAMILIES) {
    const session = buildDefenseSession({ seed: 96000, family });
    assert.equal(session.initial.query_budget, 31);
    const result = stepDefense(session, { tool: 'list-workloads', args: {} });
    assert.equal(result.ok, true);
    const index = result.evidence;
    assert.equal(index.credential_ids.length, 12);
    assert.equal(index.job_uids.length, 24);
    assert.equal(index.access_key_refs.length, 24);
    const selected = resolveIndex(index);
    assert.equal(selected.credential_ids.length, 6);
    assert.equal(selected.job_uids.length, 12);
    assert.equal(selected.access_key_refs.length, 12);
    const archiveJob = index.job_uids.find((uid) => !selected.job_uids.includes(uid));
    assert.equal(
      stepDefense(session, { tool: 'query-workload', args: { job_uid: archiveJob } }).ok,
      true,
    );
    assert.throws(() => referenceDefense(session), /query-budget-exhausted/);
  }
});

test('v30 visible reference solves all three settings within thirty-one queries', () => {
  for (const seed of [96000, 96001, 96002, 96003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 16);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.query_count, 31);
      assert.equal(score.invalid_actions, 0);
      assert.equal(score.unauthorized_completed, 0);
      assert.equal(score.blocked_approved_attempt_count, 0);
    }
  }
});

test('v30 index remains paired while native grants match visible current approvals', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 96000, family });
    const odd = buildEpisode({ seed: 96001, family });
    assert.deepEqual(even.visible.triage_index, odd.visible.triage_index);
    const left = resolveCurrentApprovals(even.visible);
    const right = resolveCurrentApprovals(odd.visible);
    assert.equal(
      left.filter((approval, index) => JSON.stringify(approval) !== JSON.stringify(right[index]))
        .length,
      1,
    );
    for (const episode of [even, odd]) {
      const native = new Map(
        episode.native.grant_snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
      );
      for (const approval of resolveCurrentApprovals(episode.visible)) {
        assert.deepEqual(approval.grants, native.get(approval.snapshot_ref)?.grants);
      }
    }
  }
});

test('v30 archive IDs match every current ID shape', () => {
  const visible = buildEpisode({ seed: 96000, family: 'reconcile-hook' }).visible;
  const core = listCoreWorkloads(
    buildV29Episode({ seed: 96000, family: 'reconcile-hook' }).visible,
  );
  const mixed = listWorkloads(visible);
  const shape = (id) => id.replace(/[a-f0-9]{16}$/u, '<digest>');
  for (const key of ['credential_ids', 'job_uids', 'access_key_refs']) {
    const current = core[key].map(shape).sort();
    const archive = mixed[key]
      .filter((id) => !core[key].includes(id))
      .map(shape)
      .sort();
    assert.deepEqual(archive, current, key);
  }
});

test('v30 keeps nonconstructible V29 seed pairs distinct and solvable', () => {
  assert.throws(
    () => buildV29Episode({ seed: 96514, family: 'reconcile-hook' }),
    /v29 has no shared active-only Job/,
  );
  for (const family of FAMILIES) {
    const first = buildEpisode({ seed: 96514, family });
    const peer = buildEpisode({ seed: 96515, family });
    const next = buildEpisode({ seed: 96516, family });
    assert.deepEqual(first.visible.triage_index, peer.visible.triage_index);
    assert.notDeepEqual(first.visible.triage_index, next.visible.triage_index);
    const evenApprovals = resolveCurrentApprovals(first.visible);
    const oddApprovals = resolveCurrentApprovals(peer.visible);
    assert.equal(
      evenApprovals.filter(
        (approval, index) => JSON.stringify(approval) !== JSON.stringify(oddApprovals[index]),
      ).length,
      1,
    );
    for (const seed of [96514, 96515, 96516, 96517]) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      for (const action of actions) {
        stepDefense(session, action);
      }
      stepDefense(session, { tool: 'submit-plan', args: {} });
      assert.equal(scoreDefense(session).success, true, `${seed}/${family}`);
    }
  }
});
