import { sha256Hex } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV24Episode } from '../v24/producer.mjs';
import { replayContainment } from '../v24/runtime.mjs';

export function buildEpisode(spec) {
  const episode = buildV24Episode(spec, { densePhaseAware: true });
  const jobs = new Map(episode.native.jobs.map((job) => [job.job_uid, job]));
  const visibleSnapshots = new Map(
    episode.visible.approval_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const nativeSnapshots = new Map(
    episode.native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const approvals = resolveCurrentApprovals(episode.visible);
  const nativeAttempts = new Map(
    episode.native.attempts.map((attempt) => [attempt.attempt_id, attempt]),
  );
  const attempts = replayContainment(episode.native, []).attempt_results;
  const selectedJobs = new Set();
  for (const attempt of attempts) {
    if (
      attempt.source_approved === false ||
      attempt.job_approved ||
      selectedJobs.has(attempt.job_uid)
    ) {
      continue;
    }
    const job = jobs.get(attempt.job_uid);
    const nativeAttempt = nativeAttempts.get(attempt.attempt_id);
    const approval = approvals.find(
      (item) =>
        item.job_uid === attempt.job_uid &&
        item.grants.some(
          (grant) =>
            grant.task.action === nativeAttempt?.action &&
            grant.task.remote_ref === nativeAttempt?.resource &&
            grant.scope.service_account_id !== job?.service_account_id,
        ),
    );
    const visible = visibleSnapshots.get(approval?.snapshot_ref);
    const native = nativeSnapshots.get(approval?.snapshot_ref);
    if (!job || !nativeAttempt || !approval || !visible || !native) {
      throw new Error('temporal Job approval is missing its native and visible snapshot');
    }
    const expiryLead =
      1 + (Number.parseInt(sha256Hex(nativeAttempt.attempt_id).slice(0, 2), 16) % 7);
    const expiresAt = attempt.event_time - expiryLead;
    if (expiresAt <= 0) {
      throw new Error('temporal Job approval expiry is before grant validity');
    }
    for (const snapshot of [visible, native]) {
      const grant = snapshot.grants.find(
        (item) =>
          item.task.action === nativeAttempt.action &&
          item.task.remote_ref === nativeAttempt.resource &&
          item.scope.service_account_id !== job.service_account_id,
      );
      if (!grant || grant.scope.valid_until <= attempt.event_time) {
        throw new Error('temporal Job approval cannot be converted to expiry');
      }
      grant.scope.service_account_id = job.service_account_id;
      grant.scope.valid_until = expiresAt;
    }
    selectedJobs.add(attempt.job_uid);
  }
  if (selectedJobs.size < 2) {
    throw new Error('temporal Job approval needs multiple source-approved gaps');
  }
  return episode;
}
