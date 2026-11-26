// An incident at the F3 workload identity cutover. The historical source,
// release, Job, Pod and STS facts are unchanged across each matched pair.
import { sha256Hex } from '../shared/estate.mjs';
import { replayContainment as replayNative } from '../v19/runtime.mjs';
import { buildEpisode as buildV20Episode } from '../v20/producer.mjs';

function pick(items, seed, purpose) {
  return [...items].sort((left, right) =>
    sha256Hex(['f3-v36', seed, purpose, left.token_ref].join('|')).localeCompare(
      sha256Hex(['f3-v36', seed, purpose, right.token_ref].join('|')),
    ),
  )[0];
}

export function buildEpisode(spec) {
  if (!Number.isSafeInteger(spec?.seed) || spec.seed < 0 || typeof spec.family !== 'string') {
    throw new Error('v36 requires a nonnegative seed and controller family');
  }
  const pairSeed = spec.seed - (spec.seed % 2);
  const episode = buildV20Episode({ seed: pairSeed, family: spec.family });
  const native = structuredClone(episode.native);
  native.action_budget = 64;
  const visible = structuredClone(episode.visible);
  const status = replayNative(native, []);
  const replacementReady = spec.seed % 2 === 0;
  const trafficSwitched = replacementReady && pairSeed % 4 === 0;
  const compromised = pick(
    status.source_provenance_results.filter((item) => !item.source_approved),
    pairSeed,
    'reissue-source',
  );
  if (!compromised) {
    throw new Error('incident cohort has no compromised release source');
  }
  const oldRoleArn = native.jobs[0].role_arn;
  if (native.jobs.some((job) => job.role_arn !== oldRoleArn)) {
    throw new Error('cutover cohort must share its old workload role');
  }
  const reissue = trafficSwitched
    ? {
        event_id: `reissue-${sha256Hex(['f3-v36', pairSeed, spec.family, 'reissue'].join('|')).slice(0, 20)}`,
        kind: 'identity-lease-reissue-queued',
        token_ref: compromised.token_ref,
        role_arn: oldRoleArn,
        planned_at: native.triage_time + 4,
        requested_object: native.jobs.find((job) => job.job_uid === compromised.job_uid).target_ref,
        session_name: null,
        source: 'release-controller',
      }
    : null;
  const rollout = {
    event_id: `rollout-${sha256Hex(['f3-v36', pairSeed, spec.family, spec.seed % 2].join('|')).slice(0, 20)}`,
    kind: 'workload-identity-cutover-status',
    old_role_arn: oldRoleArn,
    replacement_ready: replacementReady,
    replacement_probe: replacementReady
      ? 'approved-object-read-completed'
      : 'awaiting-owner-validation',
    approved_traffic_route: trafficSwitched ? 'replacement' : 'existing-identity',
    event_time: native.triage_time - 1,
    source: 'deployment-controller',
  };
  native.rollout = structuredClone(rollout);
  native.reissue = reissue
    ? {
        ...structuredClone(reissue),
        future_events: [
          {
            event_id: `${reissue.event_id}-job`,
            kind: 'job-submitted',
            event_time: native.triage_time + 1,
            auth_context_ref: reissue.token_ref,
            job_uid: `${reissue.event_id}-job-uid`,
          },
          {
            event_id: `${reissue.event_id}-pod`,
            kind: 'pod-started',
            event_time: native.triage_time + 2,
            owner_job_uid: `${reissue.event_id}-job-uid`,
            pod_uid: `${reissue.event_id}-pod-uid`,
          },
          {
            event_id: `${reissue.event_id}-sts`,
            kind: 'sts-assume-role',
            event_time: native.triage_time + 3,
            pod_uid: `${reissue.event_id}-pod-uid`,
            role_arn: oldRoleArn,
            role_session_name: `${reissue.event_id}-future-session`,
          },
          {
            event_id: `${reissue.event_id}-read`,
            kind: 'cloud-object-read',
            event_time: reissue.planned_at,
            causal_ref: `${reissue.event_id}-sts`,
            role_arn: oldRoleArn,
            resource: reissue.requested_object,
          },
        ],
      }
    : null;
  visible.incident_events = reissue ? [rollout, reissue] : [rollout];
  for (const queue of visible.job_queue) {
    queue.incident_event_refs = visible.incident_events.map((event) => event.event_id);
  }
  return { visible, native };
}
