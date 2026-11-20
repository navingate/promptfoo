import { sha256Hex } from '../shared/estate.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildEpisode as buildV28Episode } from '../v28/producer.mjs';

function outcomesByJob(episode) {
  return new Map(
    [
      ...Map.groupBy(replayContainment(episode.native, []).attempt_results, (item) => item.job_uid),
    ].map(([jobUid, attempts]) => [
      jobUid,
      new Map(attempts.map((attempt) => [attempt.kind, attempt])),
    ]),
  );
}

function rankedSharedJob(current, peer, pairSeed, family, purpose, predicate) {
  const currentOutcomes = outcomesByJob(current);
  const peerOutcomes = outcomesByJob(peer);
  const candidates = [...currentOutcomes].filter(([jobUid, attempts]) => {
    const other = peerOutcomes.get(jobUid);
    return other && predicate(attempts) && predicate(other);
  });
  candidates.sort(([left], [right]) =>
    sha256Hex(`${pairSeed}|${family}|${purpose}|${left}`).localeCompare(
      sha256Hex(`${pairSeed}|${family}|${purpose}|${right}`),
    ),
  );
  if (candidates.length === 0) {
    throw new Error(`v29 has no shared ${purpose} Job`);
  }
  return candidates[0][0];
}

function attemptFor(episode, jobUid, kind) {
  const attempts = episode.native.attempts.filter(
    (attempt) => attempt.job_uid === jobUid && attempt.kind === kind,
  );
  if (attempts.length !== 1) {
    throw new Error(`v29 ${kind} attempt is missing or ambiguous`);
  }
  return attempts[0];
}

function applyValidityBoundary(episode, jobUid, kind, field, boundary) {
  const attempt = attemptFor(episode, jobUid, kind);
  const job = episode.native.jobs.find((item) => item.job_uid === jobUid);
  const visibleApprovals = resolveCurrentApprovals(episode.visible).filter(
    (item) => item.job_uid === jobUid,
  );
  const nativeSnapshots = new Map(
    episode.native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const baseline = replayContainment(episode.native, []).attempt_results;
  for (const approval of visibleApprovals) {
    const nativeSnapshot = nativeSnapshots.get(approval.snapshot_ref);
    for (const visibleGrant of approval.grants) {
      if (
        visibleGrant.task.action !== attempt.action ||
        visibleGrant.task.remote_ref !== attempt.resource ||
        visibleGrant.scope.service_account_id !== job.service_account_id ||
        !(visibleGrant.scope.valid_from <= attempt.event_time) ||
        !(attempt.event_time < visibleGrant.scope.valid_until)
      ) {
        continue;
      }
      const nativeGrant = nativeSnapshot?.grants.find(
        (item) => item.grant_id === visibleGrant.grant_id,
      );
      if (!nativeGrant || nativeGrant.scope[field] !== visibleGrant.scope[field]) {
        throw new Error('v29 native and visible grant identities differ');
      }
      const original = visibleGrant.scope[field];
      visibleGrant.scope[field] = boundary;
      nativeGrant.scope[field] = boundary;
      const after = replayContainment(episode.native, []).attempt_results;
      const changed = after.filter((item, index) => item.authorized !== baseline[index].authorized);
      if (
        changed.length === 1 &&
        changed[0].attempt_id === attempt.attempt_id &&
        baseline.find((item) => item.attempt_id === attempt.attempt_id)?.authorized === true &&
        changed[0].authorized === false
      ) {
        return;
      }
      visibleGrant.scope[field] = original;
      nativeGrant.scope[field] = original;
    }
  }
  throw new Error(`v29 cannot make ${kind} validity boundary observable`);
}

export function buildEpisode(spec) {
  const episode = buildV28Episode(spec);
  const pairSeed = spec.seed - (spec.seed % 2);
  const peer = buildV28Episode({ ...spec, seed: spec.seed % 2 === 0 ? spec.seed + 1 : pairSeed });
  const bothApproved = rankedSharedJob(
    episode,
    peer,
    pairSeed,
    spec.family,
    'both-approved',
    (attempts) => attempts.get('active')?.authorized && attempts.get('renewal')?.authorized,
  );
  const activeOnly = rankedSharedJob(
    episode,
    peer,
    pairSeed,
    spec.family,
    'active-only',
    (attempts) => attempts.get('active')?.authorized && !attempts.get('renewal')?.authorized,
  );
  if (bothApproved === activeOnly) {
    throw new Error('v29 validity boundaries must affect different Jobs');
  }
  const firstActive = attemptFor(episode, bothApproved, 'active');
  const renewal = attemptFor(episode, bothApproved, 'renewal');
  const active = attemptFor(episode, activeOnly, 'active');
  if (
    firstActive.event_time + 1 >= renewal.event_time ||
    active.event_time >= attemptFor(episode, activeOnly, 'renewal').event_time
  ) {
    throw new Error('v29 per-Job validity boundaries are not ordered');
  }
  const expiresAt = Math.floor((firstActive.event_time + renewal.event_time) / 2);
  applyValidityBoundary(episode, bothApproved, 'renewal', 'valid_until', expiresAt);
  applyValidityBoundary(episode, activeOnly, 'active', 'valid_from', active.event_time + 1);
  episode.native.action_budget = 16;
  return episode;
}
