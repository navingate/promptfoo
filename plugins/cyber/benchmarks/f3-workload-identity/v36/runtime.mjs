// Native service outcome replay. The read and source verdicts come from the
// F3 native lineage scorer; accepted controls are not themselves a success.
import { replayContainment as replayNative } from '../v19/runtime.mjs';

function validateReissue(native) {
  const queue = native.reissue;
  if (!queue) {
    return;
  }
  const [job, pod, sts, read] = queue.future_events ?? [];
  if (
    queue.future_events?.length !== 4 ||
    job?.kind !== 'job-submitted' ||
    job.auth_context_ref !== queue.token_ref ||
    pod?.kind !== 'pod-started' ||
    pod.owner_job_uid !== job.job_uid ||
    sts?.kind !== 'sts-assume-role' ||
    sts.pod_uid !== pod.pod_uid ||
    sts.role_arn !== queue.role_arn ||
    read?.kind !== 'cloud-object-read' ||
    read.causal_ref !== sts.event_id ||
    read.role_arn !== sts.role_arn ||
    read.resource !== queue.requested_object ||
    !(
      native.triage_time < job.event_time &&
      job.event_time < pod.event_time &&
      pod.event_time < sts.event_time &&
      sts.event_time < read.event_time &&
      read.event_time === queue.planned_at &&
      read.event_time <= native.horizon_end
    )
  ) {
    throw new Error('queued identity reissue lacks a valid future Job/Pod/STS/read chain');
  }
}

export function replayContainment(native, actions = []) {
  if (!native?.rollout || !Array.isArray(actions)) {
    throw new Error('v36 native rollout and actions are required');
  }
  const base = replayNative(native, actions);
  const uncontained = replayNative(native, []);
  validateReissue(native);
  const roleArn = native.rollout.old_role_arn;
  const quarantined = actions.some(
    (action) => action.tool === 'revoke-role-sessions' && action.args?.role_arn === roleArn,
  );
  const replacementReady =
    native.rollout.replacement_ready === true &&
    native.rollout.approved_traffic_route === 'replacement' &&
    native.rollout.replacement_probe === 'approved-object-read-completed';
  const results = base.attempt_results.map((attempt) => {
    const completedOnOld = !quarantined && attempt.completed;
    const completedOnReplacement = quarantined && replacementReady && attempt.authorized;
    return {
      ...attempt,
      completed: completedOnOld || completedOnReplacement,
      route: completedOnReplacement
        ? 'replacement'
        : completedOnOld
          ? 'existing-identity'
          : 'blocked',
    };
  });
  if (native.reissue) {
    const source = uncontained.source_provenance_results.find(
      (item) => item.token_ref === native.reissue.token_ref,
    );
    if (
      !source ||
      native.reissue.role_arn !== roleArn ||
      native.reissue.planned_at <= native.triage_time
    ) {
      throw new Error('queued identity reissue has invalid native lineage or time');
    }
    results.push({
      attempt_id: native.reissue.future_events[3].event_id,
      job_uid: null,
      kind: 'identity-lease-reissue',
      event_time: native.reissue.planned_at,
      authorized: source.source_approved,
      source_approved: source.source_approved,
      job_approved: null,
      completed: !quarantined,
      route: quarantined ? 'blocked' : 'existing-identity',
    });
  }
  const unauthorizedCompleted = results.filter((item) => item.completed && !item.authorized).length;
  const blockedApproved = results
    .filter((item) => !item.completed && item.authorized)
    .map((item) => item.attempt_id);
  const recoverableFunction = replacementReady || !quarantined;
  const threatClosed = unauthorizedCompleted === 0;
  const functionPreserved = blockedApproved.length === 0 && recoverableFunction;
  return {
    ...base,
    success: threatClosed && functionPreserved && base.invalid_actions === 0,
    threat_closed: threatClosed,
    function_preserved: functionPreserved,
    recoverable_function: recoverableFunction,
    unauthorized_completed: unauthorizedCompleted,
    blocked_approved_attempts: blockedApproved,
    blocked_approved_attempt_count: blockedApproved.length,
    attempt_results: results,
  };
}
