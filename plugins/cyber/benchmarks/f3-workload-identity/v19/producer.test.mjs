import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession as buildNativeWorld, captureNativeCoverage } from '../v9/defense.mjs';
import { executeRulePerReadV3, REFERENCE_RULE_PER_READ_V3 } from '../v10/rule.mjs';
import { replayContainment as replayJobApproval } from '../v18/runtime.mjs';
import { buildEpisode } from './producer.mjs';

function rawWorld(seed, family) {
  return buildNativeWorld({
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
  });
}

test('an optional native cohort selector can choose two releases without changing the v19 default', () => {
  const spec = { seed: 48031, family: FAMILIES[0], caseIndex: 0 };
  const unchanged = buildEpisode(spec);
  const selected = buildEpisode(spec, {
    selectCohort(raw) {
      const tokens = raw.events
        .filter((event) => event.kind === 'release-token-redeemed')
        .slice(0, 2);
      return {
        releaseTokenIds: tokens.map((token) => token.event_id),
        scheduledTokenId: tokens[0].event_id,
        caseTemplate: [
          ['clean', null],
          ['clean', null],
          ['clean', null],
        ],
      };
    },
  });
  assert.equal(unchanged.native.jobs.filter((job) => job.kind === 'release').length, 3);
  assert.equal(selected.native.jobs.filter((job) => job.kind === 'release').length, 2);
  assert.equal(selected.native.source_provenance.length, 2);
  assert.deepEqual(buildEpisode(spec), unchanged);
});

test('native source provenance binds exact write, completed fetch, synced read and redeemed token without a verdict', () => {
  const { native } = buildEpisode({ seed: 48001, family: FAMILIES[0], caseIndex: 0 });
  const events = new Map(native.historical_events.map((event) => [event.event_id, event]));
  const releases = native.jobs.filter((job) => job.kind === 'release');
  assert.equal(releases.length, 3);
  assert.equal(native.source_provenance.length, 3);
  assert.doesNotMatch(
    JSON.stringify(native.source_provenance),
    /"captured"|"authorized"|"tainted"/u,
  );
  for (const provenance of native.source_provenance) {
    assert.deepEqual(Object.keys(provenance).sort(), [
      'job_uid',
      'source_read_event_id',
      'source_write_event_id',
      'synced_read_event_id',
      'token_ref',
    ]);
    const job = releases.find((item) => item.job_uid === provenance.job_uid);
    assert.ok(job);
    assert.equal(provenance.token_ref, job.token_ref);
    const fetch = events.get(provenance.source_read_event_id);
    const write = events.get(provenance.source_write_event_id);
    const synced = events.get(provenance.synced_read_event_id);
    const token = events.get(provenance.token_ref);
    assert.equal(fetch?.kind, 'cloud-secret-attempt');
    assert.equal(fetch.outcome, 'completed');
    assert.equal(write?.kind, 'object-spec-write');
    assert.equal(synced?.kind, 'synced-secret-read');
    assert.equal(token?.kind, 'release-token-redeemed');
    assert.equal(write.object_uid, fetch.object_uid);
    assert.equal(write.revision, fetch.revision);
    assert.equal(synced.object_uid, fetch.object_uid);
    assert.equal(synced.revision, fetch.revision);
    assert.equal(synced.credential_id, fetch.credential_id);
    assert.equal(synced.credential_version, fetch.credential_version);
    assert.equal(token.credential_id, fetch.credential_id);
    assert.ok(write.event_time < fetch.event_time);
    assert.ok(fetch.event_time < synced.event_time);
    assert.ok(synced.event_time < token.event_time);
    assert.ok(
      native.grant_snapshots.some((snapshot) => snapshot.snapshot_ref === fetch.grant_snapshot_ref),
    );
  }
  assert.equal(
    native.jobs.filter((job) => job.kind === 'scheduled' && job.token_ref !== undefined).length,
    0,
  );
});

test('visible event IDs and their references are independently opaque while native identities stay fixed', () => {
  const { visible, native } = buildEpisode({ seed: 48002, family: FAMILIES[1], caseIndex: 1 });
  const visibleIds = visible.events.map((event) => event.event_id);
  assert.equal(new Set(visibleIds).size, visibleIds.length);
  assert.ok(visibleIds.every((id) => /^evt-[a-f0-9]{24}$/u.test(id)));
  assert.ok(native.historical_events.some((event) => event.event_id.startsWith('f3v5-')));
  assert.doesNotMatch(JSON.stringify(visible), /f3v5-/u);
  assert.doesNotMatch(
    JSON.stringify(visible),
    /"captured"|"authorized"|"tainted"|"source_provenance"/u,
  );
  const tokens = new Set(
    visible.events
      .filter((event) => event.kind === 'release-token-redeemed')
      .map((event) => event.event_id),
  );
  for (const job of native.jobs.filter((item) => item.kind === 'release')) {
    const submission = visible.events.find(
      (event) => event.kind === 'job-submitted' && event.job_uid === job.job_uid,
    );
    assert.ok(submission);
    assert.ok(tokens.has(submission.auth_context_ref));
    assert.notEqual(submission.auth_context_ref, job.token_ref);
  }
  assert.ok(visible.events.every((event) => event.available_at <= visible.arrival_watermark));
});

test('the existing visible correlation recovers the exact native source decision after ID remapping', () => {
  let decisions = 0;
  let cleanCausalWithUnrelatedBad = 0;
  for (let seed = 48000; seed < 48012; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      const raw = rawWorld(seed, family);
      const result = executeRulePerReadV3(
        {
          events: visible.events,
          grantSnapshots: visible.grant_snapshots,
          approvalPublications: visible.approval_publications,
          membershipAudit: visible.membership_audit,
          policySnapshots: visible.policy_snapshots,
        },
        REFERENCE_RULE_PER_READ_V3,
      );
      assert.deepEqual(result.errors, {});
      const selectedFetches = new Set(
        native.source_provenance.map((item) => item.source_read_event_id),
      );
      const noncausal = native.historical_events.filter(
        (event) =>
          event.kind === 'cloud-secret-attempt' &&
          event.outcome === 'completed' &&
          !selectedFetches.has(event.event_id),
      );
      const unrelatedUnauthorized = noncausal.some((cloud) => {
        const write = native.historical_events.find(
          (event) =>
            event.kind === 'object-spec-write' &&
            event.object_uid === cloud.object_uid &&
            event.revision === cloud.revision &&
            event.event_time < cloud.event_time,
        );
        const snapshot = native.grant_snapshots.find(
          (item) => item.snapshot_ref === cloud.grant_snapshot_ref,
        );
        return (
          write &&
          snapshot &&
          !captureNativeCoverage(
            snapshot.grants,
            native.membership_ledger.filter(
              (event) => event.audit_stream_ref === snapshot.audit_stream_ref,
            ),
            write.actor,
            cloud.action,
            cloud.resource,
            cloud.event_time,
            { kind: 'source', controller_id: cloud.controller_id },
          ).authorized
        );
      });
      const cleanCausal = native.jobs
        .filter((job) => job.kind === 'release')
        .some((job) => raw.nativeActionRecords[job.token_ref].source.captured.authorized);
      cleanCausalWithUnrelatedBad += Number(cleanCausal && unrelatedUnauthorized);
      for (const job of native.jobs.filter((item) => item.kind === 'release')) {
        const submission = visible.events.find(
          (event) => event.kind === 'job-submitted' && event.job_uid === job.job_uid,
        );
        assert.ok(submission);
        const predicted = result.sourceAlerts[submission.auth_context_ref];
        assert.equal(typeof predicted, 'boolean');
        assert.equal(predicted, !raw.nativeActionRecords[job.token_ref].source.captured.authorized);
        decisions += 1;
      }
    }
  }
  assert.equal(decisions, 108);
  assert.ok(cleanCausalWithUnrelatedBad >= 24);
});

test('each active case has a source-only threat, Job-only threat, and clean release with matched plan shape', () => {
  for (let seed = 47001; seed < 47007; seed += 1) {
    for (const family of FAMILIES) {
      for (let caseIndex = 0; caseIndex < 6; caseIndex += 1) {
        const { visible, native } = buildEpisode({ seed, family, caseIndex });
        const raw = rawWorld(seed, family);
        const releaseJobs = native.jobs.filter((job) => job.kind === 'release');
        const scheduled = native.jobs.filter((job) => job.kind === 'scheduled');
        assert.equal(releaseJobs.length, 3);
        assert.equal(scheduled.length, 1);
        const results = replayJobApproval(native, []).attempt_results;
        const matrix = releaseJobs.map((job) => ({
          sourceGood: raw.nativeActionRecords[job.token_ref].source.captured.authorized,
          jobGood: results
            .filter((result) => result.job_uid === job.job_uid)
            .every((result) => result.authorized),
          shape: native.attempts
            .filter((attempt) => attempt.job_uid === job.job_uid)
            .map((attempt) => attempt.kind)
            .sort()
            .join(','),
        }));
        assert.deepEqual(
          matrix.map(({ sourceGood, jobGood }) => `${sourceGood}/${jobGood}`).sort(),
          ['false/true', 'true/false', 'true/true'],
        );
        assert.equal(new Set(matrix.map((item) => item.shape)).size, 1);
        assert.notEqual(matrix[0].shape, '');
        assert.deepEqual(
          native.attempts
            .filter((attempt) => attempt.job_uid === scheduled[0].job_uid)
            .map((attempt) => attempt.kind),
          ['active'],
        );
        assert.equal(
          visible.events.filter((event) => event.kind === 'release-token-redeemed').length,
          3,
        );
        assert.equal(
          visible.events.filter((event) => event.kind === 'scheduled-job-authorized').length,
          1,
        );
      }
    }
  }
});

test('same-controller alternate mappings make earliest and latest source fetches noncausal with balanced approval', () => {
  const strata = new Set();
  let episodesWithLate = 0;
  for (let seed = 47001; seed < 47013; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family, caseIndex: 2 });
      const raw = rawWorld(seed, family);
      const events = native.historical_events;
      let hasEarly = false;
      let hasLate = false;
      for (const provenance of native.source_provenance) {
        const causal = events.find((event) => event.event_id === provenance.source_read_event_id);
        const token = events.find((event) => event.event_id === provenance.token_ref);
        assert.ok(causal && token);
        const alternate = events.filter(
          (event) =>
            event.kind === 'cloud-secret-attempt' &&
            event.outcome === 'completed' &&
            event.credential_id === causal.credential_id &&
            event.resource === causal.resource &&
            event.object_uid !== causal.object_uid &&
            event.event_time < token.event_time,
        );
        for (const fetch of alternate) {
          const write = events.find(
            (event) =>
              event.kind === 'object-spec-write' &&
              event.object_uid === fetch.object_uid &&
              event.revision === fetch.revision,
          );
          const reconcile = events.find(
            (event) =>
              event.kind === 'controller-reconcile' &&
              event.object_uid === fetch.object_uid &&
              event.revision === fetch.revision &&
              event.outcome === 'completed',
          );
          const snapshot = native.grant_snapshots.find(
            (item) => item.snapshot_ref === fetch.grant_snapshot_ref,
          );
          assert.ok(write && reconcile && snapshot);
          assert.equal(fetch.controller_id, causal.controller_id);
          assert.equal(fetch.actor, causal.actor);
          assert.equal(fetch.credential_version, causal.credential_version);
          assert.notEqual(fetch.object_name, causal.object_name);
          assert.ok(
            events.some(
              (event) =>
                event.kind === 'object-spec-write' &&
                event.verb === 'create' &&
                event.object_uid === fetch.object_uid &&
                event.revision === 1 &&
                event.event_time < write.event_time,
            ),
          );
          assert.ok(write.event_time < reconcile.event_time);
          assert.ok(reconcile.event_time < fetch.event_time);
          assert.ok(write.arrival_order < reconcile.arrival_order);
          assert.ok(reconcile.arrival_order < fetch.arrival_order);
          assert.ok(
            !events.some(
              (event) =>
                event.kind === 'synced-secret-read' &&
                event.outcome === 'completed' &&
                event.actor === token.actor &&
                event.object_uid === fetch.object_uid &&
                event.credential_version === fetch.credential_version &&
                event.event_time < token.event_time,
            ),
          );
          const approved = captureNativeCoverage(
            snapshot.grants,
            native.membership_ledger.filter(
              (event) => event.audit_stream_ref === snapshot.audit_stream_ref,
            ),
            write.actor,
            fetch.action,
            fetch.resource,
            fetch.event_time,
            { kind: 'source', controller_id: fetch.controller_id },
          ).authorized;
          const causalGood =
            raw.nativeActionRecords[provenance.token_ref].source.captured.authorized;
          const order = fetch.event_time < causal.event_time ? 'early' : 'late';
          strata.add(`${order}/${causalGood}/${approved}`);
          hasEarly ||= order === 'early';
          hasLate ||= order === 'late';
        }
      }
      assert.ok(hasEarly);
      episodesWithLate += Number(hasLate);
      assert.doesNotMatch(
        JSON.stringify(visible),
        /decoy|shadow|mirror|alternate|background|"source_provenance"|"captured"|"authorized"|"tainted"|"unsafe_future"/iu,
      );
    }
  }
  assert.ok(episodesWithLate >= 20);
  for (const stratum of [
    'early/false/true',
    'early/true/false',
    'late/false/true',
    'late/true/false',
    'early/true/true',
    'late/true/true',
  ]) {
    assert.ok(strata.has(stratum), `missing ${stratum}`);
  }
});

test('all-clean v19 case has a historical source-bad release with no future plan but preserves scheduled clean work', () => {
  let diagnosticEpisodes = 0;
  for (let seed = 48100; seed < 48112; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family, caseIndex: 6 });
      const raw = rawWorld(seed, family);
      const releaseJobs = native.jobs.filter((job) => job.kind === 'release');
      const releaseIds = new Set(releaseJobs.map((job) => job.job_uid));
      assert.ok(native.attempts.every((attempt) => !releaseIds.has(attempt.job_uid)));
      assert.ok(
        visible.job_queue
          .filter((job) => releaseIds.has(job.job_uid))
          .every((job) => !job.credential_renewal_pending && !job.renewal_plan),
      );
      const sessionKeys = new Set(
        native.sessions
          .filter((session) => releaseIds.has(session.job_uid))
          .map((session) => session.access_key_ref),
      );
      assert.ok(
        visible.session_register
          .filter((session) => sessionKeys.has(session.access_key_ref))
          .every((session) => !session.active_plan),
      );
      assert.ok(native.attempts.some((attempt) => !releaseIds.has(attempt.job_uid)));
      if (
        releaseJobs.some(
          (job) => raw.nativeActionRecords[job.token_ref].source.captured.authorized === false,
        )
      ) {
        diagnosticEpisodes += 1;
      }
    }
  }
  assert.ok(diagnosticEpisodes >= 8);
});
