import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode as buildV19Episode } from '../v19/producer.mjs';
import { buildEpisode, projectVisible } from './producer.mjs';

const RETAINED_KINDS = new Set([
  'object-spec-write',
  'controller-reconcile',
  'cloud-secret-attempt',
  'synced-secret-read',
  'release-token-redeemed',
  'job-submitted',
  'job-admission',
  'pod-started',
  'runtime-credential-request',
  'sts-assume-web-identity',
  'sts-assume-role',
  'scheduled-job-authorized',
]);

const spec = { seed: 48001, family: FAMILIES[0], caseIndex: 0 };

function withoutAvailability(record) {
  const { available_at: _availableAt, ...retained } = record;
  return retained;
}

function expectedApprovals(original) {
  const { visible } = original;
  return visible.events
    .filter((event) => event.kind === 'job-admission' && event.outcome === 'admitted')
    .flatMap((admission) => {
      const submissions = visible.events.filter(
        (event) => event.kind === 'job-submitted' && event.job_uid === admission.job_uid,
      );
      assert.equal(submissions.length, 1);
      const submission = submissions[0];
      return [
        ['change', submission.grant_snapshot_ref, admission.approval_stream_ref],
        ['owner', submission.owner_snapshot_ref, admission.owner_approval_stream_ref],
      ].map(([lane, baseRef, streamRef]) => {
        const revisions = visible.approval_publications
          .filter((item) => item.approval_stream_ref === streamRef)
          .sort((left, right) => left.event_time - right.event_time);
        let currentRef = baseRef;
        for (const revision of revisions) {
          assert.equal(revision.previous_snapshot_ref, currentRef);
          if (revision.outcome === 'completed') {
            currentRef = revision.new_snapshot_ref;
          }
        }
        const snapshots = visible.grant_snapshots.filter(
          (snapshot) => snapshot.snapshot_ref === currentRef,
        );
        assert.equal(snapshots.length, 1);
        return {
          job_uid: admission.job_uid,
          lane,
          approval_stream_ref: streamRef,
          snapshot_ref: currentRef,
          audit_stream_ref: snapshots[0].audit_stream_ref,
          grants: snapshots[0].grants,
        };
      });
    });
}

test('v20 preserves the v19 native episode byte for byte', () => {
  const original = buildV19Episode(spec);
  const originalNative = JSON.stringify(original.native);
  const originalVisible = JSON.stringify(original.visible);
  const v20 = buildEpisode(spec);

  assert.equal(JSON.stringify(v20.native), originalNative);
  assert.equal(JSON.stringify(original.visible), originalVisible);
});

test('v20 retains exactly the causal event kinds and source snapshots', () => {
  const original = buildV19Episode(spec).visible;
  const visible = buildEpisode(spec).visible;

  assert.deepEqual(
    visible.events,
    original.events.filter((event) => RETAINED_KINDS.has(event.kind)).map(withoutAvailability),
  );
  assert.deepEqual(
    visible.grant_snapshots,
    original.grant_snapshots
      .filter((snapshot) => !snapshot.approval_stream_ref)
      .map(withoutAvailability),
  );
  for (const field of ['membership_audit', 'policy_snapshots', 'session_register', 'job_queue']) {
    assert.deepEqual(visible[field], original[field].map(withoutAvailability), field);
  }
  for (const field of ['triage_time', 'arrival_watermark', 'horizon_end']) {
    assert.equal(visible[field], original[field], field);
  }
  assert.equal('approval_publications' in visible, false);
  for (const field of [
    'events',
    'grant_snapshots',
    'membership_audit',
    'policy_snapshots',
    'session_register',
    'job_queue',
    'current_job_approvals',
  ]) {
    assert.ok(
      visible[field].every((record) => !('available_at' in record)),
      field,
    );
  }
});

test('v20 materializes the eight effective triage approvals from completed publications', () => {
  const original = buildV19Episode(spec);
  const visible = buildEpisode(spec).visible;

  assert.equal(visible.current_job_approvals.length, 8);
  assert.deepEqual(visible.current_job_approvals, expectedApprovals(original));
  assert.ok(
    visible.current_job_approvals.every(
      (record) =>
        Object.keys(record).sort().join(',') ===
        'approval_stream_ref,audit_stream_ref,grants,job_uid,lane,snapshot_ref',
    ),
  );
  const failedSnapshotRefs = new Set(
    original.visible.approval_publications
      .filter((publication) => publication.outcome === 'failed')
      .map((publication) => publication.new_snapshot_ref),
  );
  assert.ok(
    visible.current_job_approvals.every((record) => !failedSnapshotRefs.has(record.snapshot_ref)),
  );
});

test('v20 rejects broken publication lineage and future approval changes', () => {
  const broken = structuredClone(buildV19Episode(spec));
  const completed = broken.visible.approval_publications.find(
    (publication) => publication.outcome === 'completed',
  );
  assert.ok(completed);
  completed.previous_snapshot_ref = 'not-the-current-snapshot';
  assert.throws(() => projectVisible(broken), /approval publication lineage/u);

  const future = structuredClone(buildV19Episode(spec));
  future.native.approval_publications.push({
    ...future.native.approval_publications[0],
    event_id: 'future-publication',
    event_time: future.visible.triage_time + 1,
  });
  assert.throws(() => projectVisible(future), /approval publication after triage/u);

  const futureMembership = structuredClone(buildV19Episode(spec));
  futureMembership.native.membership_ledger.push({
    ...futureMembership.native.membership_ledger[0],
    event_id: 'future-membership',
    event_time: futureMembership.visible.triage_time + 1,
  });
  assert.throws(() => projectVisible(futureMembership), /membership change after triage/u);
});

test('v20 rejects duplicate admitted Jobs in the approval view', () => {
  const duplicate = structuredClone(buildV19Episode(spec));
  const admissions = duplicate.visible.events.filter(
    (event) => event.kind === 'job-admission' && event.outcome === 'admitted',
  );
  assert.equal(admissions.length, 4);
  admissions[1].job_uid = admissions[0].job_uid;

  assert.throws(() => projectVisible(duplicate), /duplicate admitted Job/u);
});

test('v20 exposes no verdict fields or literal decoy markers', () => {
  const visible = buildEpisode(spec).visible;
  const json = JSON.stringify(visible);

  assert.doesNotMatch(
    json,
    /decoy|shadow|mirror|alternate|background|"source_provenance"|"captured"|"authorized"|"tainted"|"unsafe_future"/iu,
  );
  assert.equal('native' in visible, false);
});

test('representative visible episodes fit within 65 KB', () => {
  const sizes = [0, 3, 6].map((caseIndex) =>
    Buffer.byteLength(
      JSON.stringify(
        buildEpisode({
          seed: 48001 + caseIndex,
          family: FAMILIES[caseIndex % FAMILIES.length],
          caseIndex,
        }).visible,
      ),
    ),
  );
  assert.ok(
    sizes.every((size) => size <= 65_000),
    JSON.stringify(sizes),
  );
});
