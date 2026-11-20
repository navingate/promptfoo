import { sha256Hex } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildEpisode as buildV25Episode } from '../v25/producer.mjs';

function matchingGrant(approvals, snapshots, job, attempt, denied) {
  for (const approval of approvals.filter((item) => item.job_uid === job.job_uid)) {
    const snapshot = snapshots.get(approval.snapshot_ref);
    const grant = snapshot?.grants.find(
      (item) =>
        item.task.action === attempt.action &&
        item.task.remote_ref === attempt.resource &&
        (denied
          ? item.scope.service_account_id !== job.service_account_id ||
            item.scope.valid_until <= attempt.event_time
          : item.writer_principal === job.actor &&
            item.scope.service_account_id === job.service_account_id &&
            item.scope.valid_until > attempt.event_time),
    );
    if (grant) {
      return { snapshot, grant };
    }
  }
  throw new Error('group-ledger approval has no matching grant');
}

export function buildEpisode(spec, options = {}) {
  const producerOptions = { expandedCohort: options.expandedCohort === true };
  const episode = buildV25Episode(spec, producerOptions);
  const peer = buildV25Episode(
    { ...spec, seed: spec.seed % 2 === 0 ? spec.seed + 1 : spec.seed - 1 },
    producerOptions,
  );
  const approvals = resolveCurrentApprovals(episode.visible);
  const peerApprovals = resolveCurrentApprovals(peer.visible);
  const changed = approvals.filter(
    (item, index) => JSON.stringify(item.grants) !== JSON.stringify(peerApprovals[index]?.grants),
  );
  if (changed.length !== 1) {
    throw new Error('group-ledger pair must change exactly one approval');
  }
  const flipJob = changed[0].job_uid;
  const attemptsByJob = Map.groupBy(
    replayContainment(episode.native, []).attempt_results,
    (attempt) => attempt.job_uid,
  );
  const nativeAttempts = new Map(
    episode.native.attempts.map((attempt) => [attempt.attempt_id, attempt]),
  );
  const visibleSnapshots = new Map(
    episode.visible.approval_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const nativeSnapshots = new Map(
    episode.native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const pairSeed = spec.seed - (spec.seed % 2);
  const firstArrival =
    Math.min(episode.visible.arrival_watermark, episode.native.triage_arrival_order) -
    (options.expandedCohort ? 6 * episode.native.jobs.length + 2 : 32);
  if (firstArrival < 1) {
    throw new Error('group-ledger audit cannot arrive before triage');
  }
  let groupIndex = 0;
  const moveToGroup = (job, result, denied) => {
    const attempt = nativeAttempts.get(result.attempt_id);
    if (!attempt) {
      throw new Error('group-ledger attempt is missing');
    }
    const visibleMatch = matchingGrant(approvals, visibleSnapshots, job, attempt, denied);
    const nativeMatch = matchingGrant(approvals, nativeSnapshots, job, attempt, denied);
    if (visibleMatch.grant.grant_id !== nativeMatch.grant.grant_id) {
      throw new Error('group-ledger native and visible grant identities differ');
    }
    const group = `group:f3-${sha256Hex(`${pairSeed}|${spec.family}|${job.job_uid}|${attempt.kind}|${denied}`).slice(0, 16)}`;
    for (const match of [visibleMatch, nativeMatch]) {
      match.grant.writer_principal = group;
      if (denied) {
        match.grant.scope.service_account_id = job.service_account_id;
        match.grant.scope.valid_until = episode.native.horizon_end + 20;
      }
    }
    const sequence = denied
      ? [
          ['group-member-added', 'completed'],
          ['group-member-removed', 'failed'],
          ['group-member-removed', 'completed'],
        ]
      : [
          ['group-member-removed', 'completed'],
          ['group-member-added', 'failed'],
          ['group-member-added', 'completed'],
        ];
    for (const [index, [kind, outcome]] of sequence.entries()) {
      const eventTime = episode.visible.triage_time - 12 + index * 3;
      const event = {
        event_id: `evt-${sha256Hex(`${group}|${index}`).slice(0, 24)}`,
        audit_stream_ref: visibleMatch.snapshot.audit_stream_ref,
        kind,
        outcome,
        group_principal: group,
        member_principal: job.actor,
        event_time: eventTime,
        arrival_order: firstArrival + groupIndex * 3 + index,
      };
      episode.visible.membership_audit.push(event);
      episode.native.membership_ledger.push({
        ...structuredClone(event),
        available_at: eventTime + 1,
      });
    }
    groupIndex += 1;
  };
  for (const job of episode.native.jobs) {
    const results = attemptsByJob.get(job.job_uid) ?? [];
    if (results.some((item) => item.source_approved === false)) {
      continue;
    }
    const approved = results.find((item) => item.job_approved);
    if (approved) {
      moveToGroup(job, approved, false);
    }
    if (job.job_uid !== flipJob) {
      const denied = results.find((item) => !item.job_approved);
      if (denied) {
        moveToGroup(job, denied, true);
      }
    }
  }
  if (groupIndex < 4) {
    throw new Error('group-ledger cohort needs both approved and denied membership cases');
  }
  return episode;
}
