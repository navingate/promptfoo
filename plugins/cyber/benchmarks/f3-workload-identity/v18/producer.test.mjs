import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession as buildNativeWorld, captureNativeCoverage } from '../v9/defense.mjs';
import { buildEpisode } from './producer.mjs';

function effectiveSnapshot(episode, job, lane, at) {
  const binding = job[lane];
  let ref = binding.base_snapshot_ref;
  for (const publication of episode.native.approval_publications
    .filter((item) => item.approval_stream_ref === binding.approval_stream_ref)
    .sort((left, right) => left.event_time - right.event_time)) {
    if (publication.event_time < at && publication.outcome === 'completed') {
      assert.equal(publication.previous_snapshot_ref, ref);
      ref = publication.new_snapshot_ref;
    }
  }
  const snapshot = episode.native.grant_snapshots.find((item) => item.snapshot_ref === ref);
  assert.ok(snapshot, `missing ${lane} approval snapshot ${ref}`);
  return snapshot;
}

function approved(episode, attempt) {
  const job = episode.native.jobs.find((item) => item.job_uid === attempt.job_uid);
  assert.ok(job);
  return ['change', 'owner'].every((lane) => {
    const snapshot = effectiveSnapshot(episode, job, lane, attempt.event_time);
    return captureNativeCoverage(
      snapshot.grants,
      episode.native.membership_ledger,
      job.actor,
      attempt.action,
      attempt.resource,
      attempt.event_time,
      {
        kind: 'job',
        service_account_id: job.service_account_id,
        template_id: job.template_id,
      },
    ).authorized;
  });
}

test('default v18 episodes remain byte-for-byte frozen when the optional cohort seam is added', () => {
  for (const [spec, expected] of [
    [
      { seed: 41001, family: FAMILIES[0], caseIndex: 0 },
      '54faa37efa195e0f1d44f9739e7fa1f65967449bda120a7f754125871b3b40ca',
    ],
    [
      { seed: 41002, family: FAMILIES[1], caseIndex: 4 },
      '9092bd7201313de6bdf50f6de885b72c28182a83d95546788da8d7793868397d',
    ],
  ]) {
    const actual = createHash('sha256')
      .update(JSON.stringify(buildEpisode(spec)))
      .digest('hex');
    assert.equal(actual, expected);
  }
});

test('optional cohort selects three native release histories and one independent scheduled neighbor', () => {
  const spec = { seed: 41001, family: FAMILIES[0], caseIndex: 0 };
  const world = buildNativeWorld({
    ...spec,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  });
  const tokenIds = world.events
    .filter((event) => event.kind === 'release-token-redeemed')
    .slice(0, 3)
    .map((event) => event.event_id);
  const episode = buildEpisode(spec, {
    releaseTokenIds: tokenIds,
    scheduledTokenId: tokenIds[1],
    caseTemplate: [
      ['clean', null],
      ['bad', null],
      ['clean', null],
      ['clean', null],
    ],
  });
  assert.equal(episode.native.jobs.filter((job) => job.kind === 'release').length, 3);
  assert.equal(episode.native.jobs.filter((job) => job.kind === 'scheduled').length, 1);
  assert.deepEqual(
    episode.native.jobs.filter((job) => job.kind === 'release').map((job) => job.token_ref),
    tokenIds,
  );
  assert.equal(
    episode.visible.events.filter((event) => event.kind === 'release-token-redeemed').length,
    3,
  );
  assert.equal(
    episode.visible.events.filter((event) => event.kind === 'scheduled-job-authorized').length,
    1,
  );
  assert.deepEqual(
    new Set(
      episode.visible.events
        .filter((event) => event.kind === 'job-submitted')
        .map((event) => event.job_uid),
    ),
    new Set(episode.native.jobs.map((job) => job.job_uid)),
  );
  assert.equal(episode.native.attempts.length, 4);
});

test('optional cohort rejects duplicate release tokens and a scheduled sibling outside the selection', () => {
  const spec = { seed: 41001, family: FAMILIES[0], caseIndex: 0 };
  const world = buildNativeWorld({
    ...spec,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  });
  const tokens = world.events
    .filter((event) => event.kind === 'release-token-redeemed')
    .map((event) => event.event_id);
  assert.throws(
    () =>
      buildEpisode(spec, {
        releaseTokenIds: [tokens[0], tokens[0], tokens[1]],
        scheduledTokenId: tokens[0],
      }),
    /unique release token/u,
  );
  assert.throws(
    () => buildEpisode(spec, { releaseTokenIds: tokens.slice(0, 3), scheduledTokenId: tokens[4] }),
    /selected release token/u,
  );
});

test('four-job episode keeps two native release histories and two scheduled neighbors', () => {
  const episode = buildEpisode({ seed: 41001, family: FAMILIES[0], caseIndex: 0 });
  const jobs = episode.native.jobs;
  assert.equal(jobs.length, 4);
  assert.equal(jobs.filter((job) => job.kind === 'release').length, 2);
  assert.equal(jobs.filter((job) => job.kind === 'scheduled').length, 2);
  assert.equal(new Set(jobs.map((job) => job.job_uid)).size, 4);
  assert.equal(new Set(jobs.map((job) => job.role_arn)).size, 1);
  assert.equal(new Set(jobs.map((job) => job.service_account_id)).size, 1);
  assert.equal(
    episode.visible.events.filter((event) => event.kind === 'release-token-redeemed').length,
    2,
  );
  assert.equal(
    episode.visible.events.filter((event) => event.kind === 'scheduled-job-authorized').length,
    2,
  );
  assert.equal(episode.visible.events.filter((event) => event.kind === 'job-submitted').length, 4);
  assert.deepEqual(
    new Set(
      episode.visible.events
        .filter((event) => event.kind === 'job-submitted')
        .map((event) => event.job_uid),
    ),
    new Set(jobs.map((job) => job.job_uid)),
  );
});

test('visible next-step plans match frozen attempts without revealing future verdicts', () => {
  const episode = buildEpisode({ seed: 41002, family: FAMILIES[1], caseIndex: 2 });
  const { visible, native } = episode;
  assert.equal(visible.triage_time, native.triage_time);
  assert.ok(visible.horizon_end > visible.triage_time);
  const publicPlans = [
    ...visible.session_register.flatMap((session) =>
      session.active_plan ? [session.active_plan] : [],
    ),
    ...visible.job_queue.flatMap((job) => (job.renewal_plan ? [job.renewal_plan] : [])),
  ];
  assert.equal(publicPlans.length, native.attempts.length);
  for (const attempt of native.attempts) {
    const plan = publicPlans.find((item) => item.plan_ref === attempt.plan_ref);
    assert.ok(plan, `missing public plan for ${attempt.attempt_id}`);
    assert.deepEqual(
      [plan.action, plan.resource, plan.planned_at],
      [attempt.action, attempt.resource, attempt.event_time],
    );
    assert.ok(plan.planned_at > visible.triage_time && plan.planned_at <= visible.horizon_end);
    assert.equal(attempt.iam_decision.outcome, 'allowed');
  }
  assert.ok(visible.session_register.every((session) => !Object.hasOwn(session, 'job_uid')));
  assert.ok(visible.events.every((event) => event.event_time <= visible.triage_time));
  assert.ok(visible.events.every((event) => event.available_at <= visible.arrival_watermark));
  assert.ok(
    native.delayed_records.some(
      (record) =>
        record.event_time < visible.triage_time && record.available_at > visible.arrival_watermark,
    ),
  );
  const serialized = JSON.stringify(visible);
  for (const key of [
    'attempt_id',
    'unauthorized',
    'captured',
    'expected',
    'threat_closed',
    'function_preserved',
  ]) {
    assert.equal(serialized.includes(`"${key}"`), false, `visible ${key} leaks private state`);
  }
});

test('case templates produce zero, one, and two future unauthorized candidates with executable IAM', () => {
  const counts = new Set();
  for (let caseIndex = 0; caseIndex < 7; caseIndex += 1) {
    const episode = buildEpisode({ seed: 41003, family: FAMILIES[2], caseIndex });
    const unauthorizedJobs = new Set(
      episode.native.attempts
        .filter((attempt) => !approved(episode, attempt))
        .map((attempt) => attempt.job_uid),
    );
    counts.add(unauthorizedJobs.size);
    assert.ok(
      episode.native.attempts.some(
        (attempt) => approved(episode, attempt) && attempt.kind === 'active',
      ),
    );
    assert.ok(
      episode.native.attempts.every((attempt) => attempt.iam_decision.outcome === 'allowed'),
    );
    if (unauthorizedJobs.size > 0) {
      assert.ok(episode.native.attempts.some((attempt) => !approved(episode, attempt)));
    }
  }
  assert.deepEqual(counts, new Set([0, 1, 2]));
});

test('published triage revisions have matched shape while exact scope separates an approved and unapproved release Job', () => {
  for (const family of FAMILIES) {
    for (let seed = 41000; seed < 41012; seed += 1) {
      const episode = buildEpisode({ seed, family, caseIndex: 3 });
      const releases = episode.native.jobs.filter((job) => job.kind === 'release');
      const [left, right] = releases;
      for (const lane of ['change', 'owner']) {
        const history = (job) =>
          episode.native.approval_publications
            .filter(
              (item) =>
                item.approval_stream_ref === job[lane].approval_stream_ref &&
                item.event_time > episode.native.history_end,
            )
            .map((item) => [item.event_time, item.outcome]);
        assert.deepEqual(history(left), history(right));
      }
      const futureApproved = releases.map((job) =>
        episode.native.attempts
          .filter((attempt) => attempt.job_uid === job.job_uid)
          .every((attempt) => approved(episode, attempt)),
      );
      assert.deepEqual(futureApproved.sort(), [false, true]);
      const nowApproved = releases.find((job) =>
        episode.native.attempts
          .filter((attempt) => attempt.job_uid === job.job_uid)
          .every((attempt) => approved(episode, attempt)),
      );
      const sessionKeys = new Set(
        episode.native.sessions
          .filter((session) => session.job_uid === nowApproved.job_uid)
          .map((session) => session.access_key_ref),
      );
      const priorReads = episode.native.historical_events.filter(
        (event) => event.kind === 'cloud-object-read' && sessionKeys.has(event.access_key_ref),
      );
      assert.ok(priorReads.length >= 1);
      assert.ok(
        priorReads.some((read) => !approved(episode, { ...read, job_uid: nowApproved.job_uid })),
      );
    }
  }
});

test('two issued sessions for a release Job have one live continuation and a real visible STS lineage', () => {
  const episode = buildEpisode({ seed: 41001, family: FAMILIES[0], caseIndex: 4 });
  for (const job of episode.native.jobs.filter((item) => item.kind === 'release')) {
    const sessions = episode.native.sessions.filter((session) => session.job_uid === job.job_uid);
    assert.ok(sessions.length >= 2);
    assert.equal(
      sessions.filter((session) => session.expires_at > episode.native.triage_time).length,
      1,
    );
    for (const session of sessions) {
      assert.ok(
        episode.visible.events.some(
          (event) =>
            event.kind === 'sts-assume-role' && event.access_key_ref === session.access_key_ref,
        ),
      );
      assert.ok(
        episode.visible.session_register.some(
          (entry) =>
            entry.role_arn === session.role_arn &&
            entry.role_session_name === session.role_session_name,
        ),
      );
    }
  }
});

test('visible Job and session list position varies independently of future case assignment', () => {
  const firstKinds = new Set();
  const firstReleaseJobs = new Set();
  for (let seed = 43000; seed < 43012; seed += 1) {
    const episode = buildEpisode({ seed, family: FAMILIES[0] });
    const caseChanged = buildEpisode({ seed, family: FAMILIES[0], caseIndex: 3 });
    const releaseIds = new Set(
      episode.native.jobs.filter((job) => job.kind === 'release').map((job) => job.job_uid),
    );
    assert.deepEqual(
      releaseIds,
      new Set(
        caseChanged.native.jobs.filter((job) => job.kind === 'release').map((job) => job.job_uid),
      ),
    );
    const firstJob = episode.visible.job_queue[0].job_uid;
    firstKinds.add(releaseIds.has(firstJob) ? 'release' : 'scheduled');
    firstReleaseJobs.add(firstJob);
    assert.equal(episode.visible.session_register.length, episode.native.sessions.length);
  }
  assert.deepEqual(firstKinds, new Set(['release', 'scheduled']));
  assert.ok(firstReleaseJobs.size >= 6);
});

test('target and operational objects both occur in approved and unauthorized future reads', () => {
  const tally = {
    approved: { target: 0, operational: 0 },
    unauthorized: { target: 0, operational: 0 },
  };
  for (const family of FAMILIES) {
    for (let seed = 42000; seed < 42012; seed += 1) {
      const episode = buildEpisode({ seed, family });
      for (const attempt of episode.native.attempts) {
        const job = episode.native.jobs.find((item) => item.job_uid === attempt.job_uid);
        const lane = approved(episode, attempt) ? 'approved' : 'unauthorized';
        const role = attempt.resource === job.target_ref ? 'target' : 'operational';
        assert.equal(attempt.resource, role === 'target' ? job.target_ref : job.operational_ref);
        tally[lane][role] += 1;
      }
    }
  }
  for (const lane of Object.keys(tally)) {
    assert.ok(tally[lane].target > 0 && tally[lane].operational > 0);
    assert.ok(
      Math.min(tally[lane].target, tally[lane].operational) /
        Math.max(tally[lane].target, tally[lane].operational) >=
        0.4,
    );
  }
});

test('authored neighboring S3 grants retain native principal and resource syntax', () => {
  const episode = buildEpisode({ seed: 41001, family: FAMILIES[0], caseIndex: 0 });
  for (const snapshot of episode.native.grant_snapshots) {
    for (const grant of snapshot.grants) {
      if (grant.task.action === 's3:GetObject') {
        assert.match(grant.task.remote_ref, /^s3:\/\//);
        assert.match(grant.writer_principal, /^(user:|group:)/);
      }
    }
  }
});
