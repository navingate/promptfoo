// V38 keeps the existing F3 event times and adds only a native replacement
// policy for an on-demand protected-object verification read.
import { sha256Hex } from '../shared/estate.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { buildEpisode as buildV20Episode } from '../v20/producer.mjs';

export function buildEpisode(spec) {
  const episode = buildV20Episode(spec);
  const replay = replayContainment(episode.native, []);
  const approved = replay.attempt_results.find((attempt) => attempt.authorized);
  if (!approved) {
    throw new Error('action-time screen needs an approved protected-object request');
  }
  const attempt = episode.native.attempts.find((item) => item.attempt_id === approved.attempt_id);
  const replacement = {
    policy_snapshot_ref: `replacement-policy-${sha256Hex(['f3-v38', spec.seed, spec.family].join('|')).slice(0, 16)}`,
    role_arn: `${attempt.role_arn}-replacement`,
    action: attempt.action,
    resource: attempt.resource,
    valid_from: episode.native.triage_time,
    valid_until: episode.native.horizon_end + 1,
    session_issued_at: episode.native.triage_time,
  };
  episode.native.replacement_probe = structuredClone(replacement);
  episode.visible.replacement_probe_policy = structuredClone(replacement);
  return episode;
}
