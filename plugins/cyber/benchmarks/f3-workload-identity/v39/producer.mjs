// Paired native approval counterfactual for two reads from one F3 workload
// session. The only twin difference is the effective Job grant for object B.
import { sha256Hex } from '../shared/estate.mjs';
import { buildEpisode as buildV19Episode } from '../v19/producer.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { projectVisible } from '../v20/producer.mjs';

function id(prefix, spec, purpose) {
  return `${prefix}-${sha256Hex(['f3-v39', spec.seed, spec.family, purpose].join('|')).slice(0, 20)}`;
}

function addPolicyResource(records, policyRef, resource) {
  const policy = records.find((item) => item.snapshot_ref === policyRef);
  if (!policy || !Array.isArray(policy.policy?.resources)) {
    throw new Error('role policy snapshot is missing');
  }
  policy.policy.resources.push(resource);
}

function addEffectiveGrant(records, snapshotRef, action, sourceObject, targetObject, spec, lane) {
  const snapshot = records.find((item) => item.snapshot_ref === snapshotRef);
  if (!snapshot || !Array.isArray(snapshot.grants)) {
    throw new Error('effective Job grant snapshot is missing');
  }
  const covering = snapshot.grants.filter(
    (grant) => grant.task?.action === action && grant.task?.remote_ref === sourceObject,
  );
  if (covering.length === 0) {
    throw new Error('approved object A has no matching effective Job grant');
  }
  snapshot.grants.push(
    ...covering.map((grant, index) => ({
      ...structuredClone(grant),
      grant_id: id('jobgrant', spec, `${lane}-${snapshotRef}-${index}-object-b`),
      writer_principal:
        spec.variant === 'b-approved'
          ? grant.writer_principal
          : `user:wl-${sha256Hex(['f3-v39', spec.seed, spec.family, lane, 'parallel-grant-writer'].join('|')).slice(0, 16)}`,
      task: { ...grant.task, remote_ref: targetObject },
    })),
  );
}

export function buildEpisode(spec) {
  if (
    !Number.isSafeInteger(spec?.seed) ||
    spec.seed < 0 ||
    typeof spec.family !== 'string' ||
    !['b-approved', 'b-unapproved'].includes(spec.variant)
  ) {
    throw new Error('v39 requires seed, controller family and approval variant');
  }
  const episode = buildV19Episode({ seed: spec.seed, family: spec.family });
  const baseline = replayContainment(episode.native, []);
  const approvedA = baseline.attempt_results.find(
    (attempt) => attempt.authorized && attempt.kind === 'active',
  );
  if (!approvedA) {
    throw new Error('native cohort lacks an approved issued-session read');
  }
  const attemptA = episode.native.attempts.find(
    (attempt) => attempt.attempt_id === approvedA.attempt_id,
  );
  const session = episode.native.sessions.find(
    (item) =>
      item.role_arn === attemptA.role_arn &&
      item.role_session_name === attemptA.role_session_name &&
      item.job_uid === attemptA.job_uid,
  );
  if (
    !session ||
    session.issued_at > attemptA.event_time ||
    attemptA.event_time >= session.expires_at ||
    session.revoked_at !== undefined
  ) {
    throw new Error('object A lacks a live legitimately issued session');
  }
  const objectB = `s3://tenant-export/object-${sha256Hex(['f3-v39', spec.seed, spec.family, 'object-b'].join('|')).slice(0, 16)}`;
  episode.native.iam_policy.resources.push(objectB);
  addPolicyResource(
    episode.native.policy_snapshots,
    episode.native.iam_policy.policy_snapshot_ref,
    objectB,
  );
  addPolicyResource(
    episode.visible.policy_snapshots,
    episode.native.iam_policy.policy_snapshot_ref,
    objectB,
  );

  const projected = projectVisible(episode);
  for (const lane of ['change', 'owner']) {
    const current = projected.current_job_approvals.find(
      (item) => item.job_uid === attemptA.job_uid && item.lane === lane,
    );
    if (!current) {
      throw new Error('selected Job is missing a current approval lane');
    }
    addEffectiveGrant(
      episode.native.grant_snapshots,
      current.snapshot_ref,
      attemptA.action,
      attemptA.resource,
      objectB,
      spec,
      lane,
    );
    addEffectiveGrant(
      episode.visible.grant_snapshots,
      current.snapshot_ref,
      attemptA.action,
      attemptA.resource,
      objectB,
      spec,
      lane,
    );
  }

  const attemptB = {
    ...structuredClone(attemptA),
    attempt_id: id('attempt', spec, 'object-b'),
    plan_ref: id('plan', spec, 'object-b'),
    resource: objectB,
  };
  episode.native.attempts.push(attemptB);
  const replacementProbe = {
    policy_snapshot_ref: id('replacement-policy', spec, 'object-a'),
    role_arn: `${attemptA.role_arn}-replacement`,
    action: attemptA.action,
    resource: attemptA.resource,
    valid_from: episode.native.triage_time,
    valid_until: episode.native.horizon_end + 1,
    session_issued_at: episode.native.triage_time,
  };
  episode.native.replacement_probe = structuredClone(replacementProbe);
  const visibleSession = episode.visible.session_register.find(
    (item) =>
      item.role_arn === attemptA.role_arn && item.role_session_name === attemptA.role_session_name,
  );
  if (!visibleSession?.active_plan || visibleSession.active_plan.plan_ref !== attemptA.plan_ref) {
    throw new Error('visible object A plan is not bound to the selected session');
  }
  visibleSession.parallel_plan = {
    plan_ref: attemptB.plan_ref,
    action: attemptB.action,
    resource: objectB,
    planned_at: attemptB.event_time,
    published_by: 'workload-controller',
    publication_digest: sha256Hex(
      ['f3-v39', spec.seed, spec.family, attemptB.plan_ref, objectB, attemptB.event_time].join('|'),
    ),
  };
  const visible = projectVisible(episode);
  visible.replacement_probe_policy = structuredClone(replacementProbe);
  const paired = replayContainment(episode.native, []);
  const resultA = paired.attempt_results.find((item) => item.attempt_id === attemptA.attempt_id);
  const resultB = paired.attempt_results.find((item) => item.attempt_id === attemptB.attempt_id);
  if (
    !resultA?.authorized ||
    resultB?.authorized !== (spec.variant === 'b-approved') ||
    resultB?.source_approved !== resultA.source_approved
  ) {
    throw new Error('paired native Job approval hinge did not produce the intended read outcomes');
  }
  return {
    native: episode.native,
    visible,
    pair: {
      attempt_a: attemptA.attempt_id,
      attempt_b: attemptB.attempt_id,
      role_arn: attemptA.role_arn,
      role_session_name: attemptA.role_session_name,
      object_a: attemptA.resource,
      object_b: objectB,
    },
  };
}
