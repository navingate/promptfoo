import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';

test('v27 group audit decisions remain query-solvable at seven or eight controls', () => {
  for (const seed of [87000, 87001, 87002, 87003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      assert.equal(actions.length, seed % 2 === 0 ? 7 : 8);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.equal(score.blocked_approved_attempt_count, 0);
    }
  }
});

test('v27 current group grants and membership ledger match native and visible state', () => {
  for (const family of FAMILIES) {
    const { visible, native } = buildEpisode({ seed: 87000, family });
    const current = resolveCurrentApprovals(visible);
    const nativeSnapshots = new Map(
      native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
    );
    for (const approval of current) {
      assert.deepEqual(nativeSnapshots.get(approval.snapshot_ref)?.grants, approval.grants);
    }
    const groupGrants = current.flatMap((item) =>
      item.grants.filter((grant) => grant.writer_principal.startsWith('group:f3-')),
    );
    assert.ok(groupGrants.length >= 4, family);
    const nativeEvents = native.membership_ledger.filter((event) =>
      event.group_principal.startsWith('group:f3-'),
    );
    const visibleEvents = visible.membership_audit.filter((event) =>
      event.group_principal.startsWith('group:f3-'),
    );
    assert.deepEqual(
      nativeEvents.map(({ available_at: _availableAt, ...event }) => event),
      visibleEvents,
    );
    assert.ok(visibleEvents.some((event) => event.outcome === 'failed'));
    assert.ok(visibleEvents.some((event) => event.kind === 'group-member-removed'));
    assert.ok(visibleEvents.some((event) => event.kind === 'group-member-added'));
    assert.ok(
      visibleEvents.every(
        (event) =>
          event.event_time < visible.triage_time &&
          event.arrival_order <= visible.arrival_watermark,
      ),
    );
    assert.ok(
      nativeEvents.every(
        (event) =>
          event.available_at <= native.triage_time &&
          event.arrival_order <= native.triage_arrival_order,
      ),
    );
  }
});

test('v27 pair keeps group evidence fixed and changes one approval and renewal control', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 87000, family }).visible;
    const odd = buildEpisode({ seed: 87001, family }).visible;
    assert.deepEqual(even.events, odd.events);
    assert.deepEqual(even.approval_publications, odd.approval_publications);
    assert.deepEqual(even.membership_audit, odd.membership_audit);
    assert.deepEqual(even.session_register, odd.session_register);
    assert.deepEqual(even.job_queue, odd.job_queue);
    const left = resolveCurrentApprovals(even);
    const right = resolveCurrentApprovals(odd);
    assert.equal(
      left.filter((item, index) => JSON.stringify(item) !== JSON.stringify(right[index])).length,
      1,
    );
    const evenActions = referenceDefense(buildDefenseSession({ seed: 87000, family }));
    const oddActions = referenceDefense(buildDefenseSession({ seed: 87001, family }));
    const added = oddActions.filter(
      (action) => !evenActions.some((other) => JSON.stringify(other) === JSON.stringify(action)),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].tool, 'pause-job');
  }
});
