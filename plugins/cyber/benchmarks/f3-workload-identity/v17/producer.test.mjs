import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, stepDefense } from '../v9/defense.mjs';

function v17Spec(seed, family) {
  return {
    seed,
    family,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  };
}

test('v17 captures six source and twelve dual-lane Job decisions from native reads', () => {
  for (const family of FAMILIES) {
    for (const seed of [35001, 35002]) {
      const world = buildDefenseSession(v17Spec(seed, family));
      const target = [];
      const operational = [];
      const position = { first: [], second: [] };
      const laneStates = new Set();
      let sourceAlerts = 0;
      assert.equal(Object.keys(world.nativeActionRecords).length, 6);
      for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
        sourceAlerts += Number(!record.source.captured.authorized);
        const submission = world.events.find(
          (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
        );
        const admission = world.events.find(
          (event) =>
            event.kind === 'job-admission' &&
            event.causal_ref === submission?.event_id &&
            event.outcome === 'admitted',
        );
        assert.ok(submission?.owner_snapshot_ref);
        assert.ok(admission?.approval_stream_ref);
        assert.ok(admission?.owner_approval_stream_ref);
        assert.notEqual(admission.approval_stream_ref, admission.owner_approval_stream_ref);
        assert.equal(record.job.reads.length, 2);
        const reads = [...record.job.reads].sort(
          (left, right) => left.action.event_time - right.action.event_time,
        );
        assert.ok(reads[0].action.event_time + 1 < reads[1].action.event_time);
        for (let index = 0; index < reads.length; index += 1) {
          const read = reads[index];
          const cloud = world.events.find((event) => event.event_id === read.action.event_id);
          const checkpoint = world.events.find(
            (event) => event.event_id === read.checkpoint_event_id,
          );
          assert.equal(cloud?.kind, 'cloud-object-read');
          assert.equal(cloud.outcome, 'completed');
          assert.equal(read.captured.action_time, cloud.event_time);
          assert.equal(
            read.captured.authorized,
            read.approval_lanes.change.authorized && read.approval_lanes.owner.authorized,
          );
          assert.equal(checkpoint?.cloud_read_event_id, cloud.event_id);
          assert.equal('grant_snapshot_ref' in cloud, false);
          assert.equal('owner_snapshot_ref' in cloud, false);
          assert.equal('authorized' in cloud, false);
          assert.equal(
            read.approval_lanes.change.snapshot_ref === submission.grant_snapshot_ref ||
              world.approvalPublications.some(
                (event) =>
                  event.approval_stream_ref === admission.approval_stream_ref &&
                  event.new_snapshot_ref === read.approval_lanes.change.snapshot_ref,
              ),
            true,
          );
          assert.equal(
            read.approval_lanes.owner.snapshot_ref === submission.owner_snapshot_ref ||
              world.approvalPublications.some(
                (event) =>
                  event.approval_stream_ref === admission.owner_approval_stream_ref &&
                  event.new_snapshot_ref === read.approval_lanes.owner.snapshot_ref,
              ),
            true,
          );
          laneStates.add(
            `${read.approval_lanes.change.authorized}/${read.approval_lanes.owner.authorized}`,
          );
          (read.role === 'target' ? target : operational).push(read.captured.authorized);
          position[index === 0 ? 'first' : 'second'].push(read.captured.authorized);
        }
        const clouds = reads.map((read) =>
          world.events.find((event) => event.event_id === read.action.event_id),
        );
        assert.equal(clouds[0].access_key_ref, clouds[1].access_key_ref);
      }
      assert.equal(sourceAlerts, 2);
      assert.equal(target.filter((value) => !value).length, 3);
      assert.equal(operational.filter((value) => !value).length, 3);
      assert.equal(position.first.filter((value) => !value).length, 3);
      assert.equal(position.second.filter((value) => !value).length, 3);
      assert.deepEqual(
        laneStates,
        new Set(['true/true', 'true/false', 'false/true', 'false/false']),
      );
      assert.ok(world.approvalPublications.length >= 24);
      const admissions = world.events.filter(
        (event) => event.kind === 'job-admission' && event.outcome === 'admitted',
      );
      assert.equal(admissions.length, 12);
      for (const admission of admissions) {
        assert.ok(admission.approval_stream_ref);
        assert.ok(admission.owner_approval_stream_ref);
        for (const streamRef of [
          admission.approval_stream_ref,
          admission.owner_approval_stream_ref,
        ]) {
          assert.equal(
            world.approvalPublications.filter((event) => event.approval_stream_ref === streamRef)
              .length,
            2,
          );
        }
      }
      const grants = stepDefense(world, { tool: 'get-grants' });
      assert.equal(grants.ok, true);
      assert.deepEqual(grants.approval_publications, world.approvalPublications);
      assert.ok(grants.grant_snapshots.some((item) => item.approval_stream_ref));
    }
  }
});

test('legacy v16 has no v17 approval feed or owner admission fields', () => {
  const world = buildDefenseSession({
    ...v17Spec(35001, FAMILIES[0]),
    dualApprovalRevision: false,
  });
  assert.equal(world.approvalPublications, undefined);
  assert.equal(
    world.events.some((event) => event.owner_approval_stream_ref),
    false,
  );
  const grants = stepDefense(world, { tool: 'get-grants' });
  assert.equal('approval_publications' in grants, false);
});
