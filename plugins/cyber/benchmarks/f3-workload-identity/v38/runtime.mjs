// Response-time replay over immutable F3 read plans. Source and Job approval
// come from v19 native lineage; controls take effect at their action time.
import { replayContainment } from '../v19/runtime.mjs';

function sessionKey(roleArn, name) {
  return `${roleArn}\0${name}`;
}

function matchAction(native, action) {
  const args = action?.args ?? {};
  if (action?.tool === 'deny-role-session') {
    return (
      Object.keys(args).length === 2 &&
      native.sessions.some(
        (session) =>
          session.role_arn === args.role_arn &&
          session.role_session_name === args.role_session_name,
      )
    );
  }
  if (action?.tool === 'pause-job') {
    return (
      Object.keys(args).length === 1 && native.jobs.some((job) => job.job_uid === args.job_uid)
    );
  }
  if (
    ['hold-issuance', 'drain-old-work', 'verify-replacement-read', 'retire-old-role'].includes(
      action?.tool,
    )
  ) {
    return Object.keys(args).length === 0;
  }
  return false;
}

function attemptOutcome(attempt, controls) {
  const relevant = controls.filter((control) => control.event_time <= attempt.event_time);
  const retired = relevant.some((control) => control.tool === 'retire-old-role');
  const held =
    attempt.kind === 'renewal' && relevant.some((control) => control.tool === 'hold-issuance');
  const paused =
    attempt.kind === 'renewal' &&
    relevant.some(
      (control) => control.tool === 'pause-job' && control.args.job_uid === attempt.job_uid,
    );
  const denied =
    attempt.kind === 'active' &&
    relevant.some(
      (control) =>
        control.tool === 'deny-role-session' &&
        sessionKey(control.args.role_arn, control.args.role_session_name) ===
          sessionKey(attempt.role_arn, attempt.role_session_name),
    );
  const blockedReason = retired
    ? 'old-role-retired'
    : held
      ? 'issuance-held'
      : paused
        ? 'job-paused'
        : denied
          ? 'exact-session-denied'
          : null;
  return {
    ...attempt,
    completed: blockedReason === null,
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
  };
}

export function replayTimed(native, actions = []) {
  if (!native?.replacement_probe || !Array.isArray(actions)) {
    throw new Error('v38 native replacement policy and action array are required');
  }
  const base = replayContainment(native, []);
  const byId = new Map(base.attempt_results.map((attempt) => [attempt.attempt_id, attempt]));
  const probeGrounded = native.attempts.some(
    (attempt) =>
      byId.get(attempt.attempt_id)?.authorized &&
      attempt.action === native.replacement_probe.action &&
      attempt.resource === native.replacement_probe.resource &&
      `${attempt.role_arn}-replacement` === native.replacement_probe.role_arn,
  );
  if (!probeGrounded) {
    throw new Error('replacement policy is not grounded in an approved native read');
  }
  let now = native.triage_time;
  let invalid = 0;
  let verification = null;
  const controls = [];
  const receipts = [];
  for (const action of actions) {
    now += 1;
    if (!matchAction(native, action)) {
      invalid += 1;
      receipts.push({ tool: action?.tool ?? null, event_time: now, accepted: false });
      continue;
    }
    if (action.tool === 'drain-old-work') {
      now = Math.max(now, ...native.attempts.map((attempt) => attempt.event_time));
      receipts.push({
        tool: action.tool,
        event_time: now,
        accepted: true,
        reads: native.attempts
          .filter((attempt) => attempt.event_time <= now)
          .map((attempt) =>
            attemptOutcome({ ...attempt, ...byId.get(attempt.attempt_id) }, controls),
          )
          .map(({ attempt_id, authorized, completed, blocked_reason }) => ({
            attempt_id,
            authorized,
            completed,
            ...(blocked_reason ? { blocked_reason } : {}),
          })),
      });
      continue;
    }
    if (action.tool === 'verify-replacement-read') {
      const policy = native.replacement_probe;
      const completed =
        policy.valid_from <= now &&
        now < policy.valid_until &&
        policy.session_issued_at <= now &&
        probeGrounded;
      verification = {
        event_id: `replacement-read-${policy.policy_snapshot_ref}`,
        kind: 'protected-object-read',
        event_time: now,
        role_arn: policy.role_arn,
        action: policy.action,
        resource: policy.resource,
        outcome: completed ? 'completed' : 'denied',
      };
      receipts.push({ tool: action.tool, event_time: now, accepted: true, read: verification });
      continue;
    }
    controls.push({ tool: action.tool, args: action.args ?? {}, event_time: now });
    receipts.push({ tool: action.tool, event_time: now, accepted: true });
  }
  const attemptResults = native.attempts.map((attempt) =>
    attemptOutcome({ ...attempt, ...byId.get(attempt.attempt_id) }, controls),
  );
  const unauthorizedCompleted = attemptResults.filter(
    (attempt) => attempt.completed && !attempt.authorized,
  ).length;
  const blockedApproved = attemptResults
    .filter((attempt) => !attempt.completed && attempt.authorized)
    .map((attempt) => attempt.attempt_id);
  const retired = controls.some((control) => control.tool === 'retire-old-role');
  const replacementVerified = verification?.outcome === 'completed';
  const recoverableFunction = blockedApproved.length === 0 && (!retired || replacementVerified);
  return {
    success: unauthorizedCompleted === 0 && recoverableFunction && invalid === 0,
    unauthorized_completed: unauthorizedCompleted,
    blocked_approved_attempts: blockedApproved,
    blocked_approved_attempt_count: blockedApproved.length,
    replacement_read_completed: replacementVerified,
    old_role_retired: retired,
    recoverable_function: recoverableFunction,
    invalid_actions: invalid,
    attempt_results: attemptResults,
    receipts,
  };
}
