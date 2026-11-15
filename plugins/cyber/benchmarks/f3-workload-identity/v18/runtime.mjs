// Native, in-process response plane for the F3 workload-identity continuation.
// It reads immutable producer facts; the model-facing defense must expose only
// pre-triage observations until the defender submits a final action plan.
import { captureNativeCoverage } from '../v9/defense.mjs';
import { selectEffectiveApproval } from '../v17/approval_plane.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function requiredTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function sessionKey(roleArn, sessionName) {
  return `${roleArn}\0${sessionName}`;
}

function approvalStream(native, lane) {
  const { approval_stream_ref: streamRef, base_snapshot_ref: baseRef } = lane;
  requiredString(streamRef, 'approval_stream_ref');
  requiredString(baseRef, 'base_snapshot_ref');
  const base = native.grant_snapshots.find((item) => item.snapshot_ref === baseRef);
  if (!base || base.approval_stream_ref !== streamRef) {
    throw new Error('approval base snapshot is missing or belongs to another stream');
  }
  return {
    approval_stream_ref: streamRef,
    snapshots: [
      base,
      ...native.grant_snapshots.filter(
        (item) => item.approval_stream_ref === streamRef && item.snapshot_ref !== baseRef,
      ),
    ],
    publications: native.approval_publications.filter(
      (item) => item.approval_stream_ref === streamRef,
    ),
  };
}

function authorizedAt(native, job, attempt) {
  const scope = {
    kind: 'job',
    service_account_id: job.service_account_id,
    template_id: job.template_id,
  };
  return ['change', 'owner'].every((laneName) => {
    const snapshot = selectEffectiveApproval(
      approvalStream(native, job[laneName]),
      attempt.event_time,
    );
    return captureNativeCoverage(
      snapshot.grants,
      native.membership_ledger.filter(
        (item) => item.audit_stream_ref === snapshot.audit_stream_ref,
      ),
      job.actor,
      attempt.action,
      attempt.resource,
      attempt.event_time,
      scope,
    ).authorized;
  });
}

function validateJobs(native) {
  const jobs = new Map();
  for (const job of native.jobs) {
    const uid = requiredString(job?.job_uid, 'job_uid');
    if (jobs.has(uid)) {
      throw new Error('duplicate job_uid');
    }
    requiredString(job.actor, 'job actor');
    requiredString(job.service_account_id, 'service_account_id');
    requiredString(job.template_id, 'template_id');
    requiredString(job.role_arn, 'job role_arn');
    if (!job.change || !job.owner) {
      throw new Error('job approval lanes missing');
    }
    jobs.set(uid, job);
  }
  return jobs;
}

function validateApprovalHistory(native) {
  const snapshots = new Set();
  for (const snapshot of native.grant_snapshots) {
    const ref = requiredString(snapshot?.snapshot_ref, 'snapshot_ref');
    if (snapshots.has(ref)) {
      throw new Error('duplicate approval snapshot');
    }
    snapshots.add(ref);
    if (snapshot.approval_stream_ref !== undefined) {
      requiredString(snapshot.approval_stream_ref, 'approval_stream_ref');
    }
    requiredArray(snapshot.grants, 'snapshot grants');
  }
  for (const publication of native.approval_publications) {
    if (requiredTime(publication?.event_time, 'approval event_time') > native.triage_time) {
      throw new Error('future approval publication would be hidden at triage');
    }
  }
  for (const membership of native.membership_ledger) {
    if (requiredTime(membership?.event_time, 'membership event_time') > native.triage_time) {
      throw new Error('future membership change would be hidden at triage');
    }
  }
}

function validateIamPolicy(native) {
  if (native.iam_policy !== undefined) {
    const policy = native.iam_policy;
    requiredString(policy.policy_snapshot_ref, 'IAM policy_snapshot_ref');
    requiredString(policy.role_arn, 'IAM role_arn');
    requiredArray(policy.actions, 'IAM actions');
    requiredArray(policy.resources, 'IAM resources');
    requiredTime(policy.valid_from, 'IAM valid_from');
    requiredTime(policy.valid_until, 'IAM valid_until');
    if (policy.valid_until <= policy.valid_from) {
      throw new Error('IAM policy interval invalid');
    }
    if (
      !native.policy_snapshots?.some((item) => item.snapshot_ref === policy.policy_snapshot_ref)
    ) {
      throw new Error('native IAM policy snapshot is missing');
    }
  }
}

function validateSessions(native, jobs) {
  const sessions = new Map();
  for (const session of native.sessions) {
    const job = jobs.get(requiredString(session?.job_uid, 'session job_uid'));
    if (!job) {
      throw new Error('session refers to unknown job');
    }
    const roleArn = requiredString(session.role_arn, 'session role_arn');
    const name = requiredString(session.role_session_name, 'role_session_name');
    if (roleArn !== job.role_arn) {
      throw new Error('session role does not match job role');
    }
    const key = sessionKey(roleArn, name);
    if (sessions.has(key)) {
      throw new Error('duplicate issued session identity');
    }
    requiredTime(session.issued_at, 'issued_at');
    requiredTime(session.expires_at, 'expires_at');
    if (session.issued_at > native.triage_time || session.expires_at <= session.issued_at) {
      throw new Error('issued session timing is invalid');
    }
    if (session.revoked_at !== undefined) {
      requiredTime(session.revoked_at, 'revoked_at');
      if (session.revoked_at > native.triage_time) {
        throw new Error('future session revocation would be hidden at triage');
      }
    }
    sessions.set(key, session);
  }
  return sessions;
}

function validateAttemptIam(native, attempt, roleArn) {
  if (attempt.iam_decision?.outcome !== 'allowed') {
    throw new Error('planned read must have an independent allowed native IAM decision');
  }
  if (native.iam_policy) {
    const policy = native.iam_policy;
    const allowed =
      policy.policy_snapshot_ref === attempt.iam_decision.policy_snapshot_ref &&
      policy.role_arn === roleArn &&
      policy.actions.includes(attempt.action) &&
      policy.resources.includes(attempt.resource) &&
      policy.valid_from <= attempt.event_time &&
      attempt.event_time < policy.valid_until;
    if (!allowed) {
      throw new Error('native IAM decision disagrees with policy facts');
    }
  }
  if (attempt.iam_decision.policy_snapshot_ref !== undefined) {
    const ref = requiredString(attempt.iam_decision.policy_snapshot_ref, 'policy_snapshot_ref');
    if (!native.policy_snapshots?.some((item) => item.snapshot_ref === ref)) {
      throw new Error('native IAM policy snapshot is missing');
    }
  }
}

function validateAttemptSession(attempt, sessions, futureSessionNames, roleArn, name) {
  const key = sessionKey(roleArn, name);
  if (attempt.kind === 'active') {
    const session = sessions.get(key);
    if (
      !session ||
      session.job_uid !== attempt.job_uid ||
      session.issued_at > attempt.event_time ||
      session.expires_at <= attempt.event_time ||
      (session.revoked_at !== undefined && session.revoked_at <= attempt.event_time)
    ) {
      throw new Error('active attempt has no live matching issued session');
    }
  } else {
    if (sessions.has(key) || futureSessionNames.has(key)) {
      throw new Error('renewal must create a distinct future session');
    }
    futureSessionNames.add(key);
  }
}

function validateAttempts(native, jobs, sessions) {
  const attemptIds = new Set();
  const futureSessionNames = new Set();
  for (const attempt of native.attempts) {
    const id = requiredString(attempt?.attempt_id, 'attempt_id');
    if (attemptIds.has(id)) {
      throw new Error('duplicate future attempt ID');
    }
    attemptIds.add(id);
    const job = jobs.get(requiredString(attempt.job_uid, 'attempt job_uid'));
    if (!job) {
      throw new Error('attempt refers to unknown job');
    }
    if (attempt.kind !== 'active' && attempt.kind !== 'renewal') {
      throw new Error('attempt kind must be active or renewal');
    }
    if (requiredTime(attempt.event_time, 'attempt event_time') <= native.triage_time) {
      throw new Error('future attempt must occur after triage');
    }
    requiredString(attempt.action, 'attempt action');
    requiredString(attempt.resource, 'attempt resource');
    const roleArn = requiredString(attempt.role_arn, 'attempt role_arn');
    const name = requiredString(attempt.role_session_name, 'attempt role_session_name');
    if (roleArn !== job.role_arn) {
      throw new Error('attempt role does not match job role');
    }
    validateAttemptIam(native, attempt, roleArn);
    validateAttemptSession(attempt, sessions, futureSessionNames, roleArn, name);
  }
}

function validateNative(native) {
  if (!native || typeof native !== 'object' || Array.isArray(native)) {
    throw new Error('native episode must be an object');
  }
  requiredTime(native.triage_time, 'triage_time');
  if (native.action_budget !== undefined) {
    requiredTime(native.action_budget, 'action_budget');
  }
  for (const key of [
    'jobs',
    'sessions',
    'attempts',
    'grant_snapshots',
    'approval_publications',
    'membership_ledger',
  ]) {
    requiredArray(native[key], key);
  }
  const jobs = validateJobs(native);
  validateApprovalHistory(native);
  validateIamPolicy(native);
  const sessions = validateSessions(native, jobs);
  validateAttempts(native, jobs, sessions);
  for (const job of jobs.values()) {
    for (const lane of ['change', 'owner']) {
      // Validate the stream and every publication even when no attempt names it.
      const stream = approvalStream(native, job[lane]);
      selectEffectiveApproval(stream, native.triage_time + 1);
    }
  }
  return { jobs, sessions };
}

function applyAction(action, native, jobs, sessions, pausedJobs, deniedSessions, revokedRoles) {
  const args = action?.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { reason: 'invalid-args' };
  }
  if (action.tool === 'pause-job') {
    if (typeof args.job_uid !== 'string' || !jobs.has(args.job_uid)) {
      return { reason: 'unknown-job' };
    }
    if (pausedJobs.has(args.job_uid)) {
      return { effect: 'already-applied' };
    }
    pausedJobs.add(args.job_uid);
    return { effect: 'applied' };
  }
  if (action.tool === 'deny-role-session') {
    const key = sessionKey(args.role_arn, args.role_session_name);
    if (
      typeof args.role_arn !== 'string' ||
      typeof args.role_session_name !== 'string' ||
      !sessions.has(key)
    ) {
      return { reason: 'unknown-issued-session' };
    }
    if (deniedSessions.has(key)) {
      return { effect: 'already-applied' };
    }
    deniedSessions.add(key);
    return { effect: 'applied' };
  }
  if (action.tool === 'revoke-role-sessions') {
    if (
      typeof args.role_arn !== 'string' ||
      !native.sessions.some((session) => session.role_arn === args.role_arn)
    ) {
      return { reason: 'unknown-role' };
    }
    if (revokedRoles.has(args.role_arn)) {
      return { effect: 'already-applied' };
    }
    revokedRoles.add(args.role_arn);
    return { effect: 'applied' };
  }
  return { reason: 'unknown-tool' };
}

function applyActions(native, actions, jobs, sessions) {
  const pausedJobs = new Set();
  const deniedSessions = new Set();
  const revokedRoles = new Set();
  const action_log = [];
  const rejected_actions = [];
  const budget = native.action_budget ?? 8;
  for (const [index, action] of actions.entries()) {
    const { reason = null, effect = 'applied' } =
      index >= budget
        ? { reason: 'action-budget-exhausted' }
        : applyAction(action, native, jobs, sessions, pausedJobs, deniedSessions, revokedRoles);
    const entry = {
      index,
      tool: action?.tool ?? null,
      args: action?.args ?? null,
      actor: 'defender',
      event_time: native.triage_time,
      authority: 'f3-containment',
      accepted: reason === null,
      ...(reason ? { reason } : { effect }),
    };
    action_log.push(entry);
    if (reason) {
      rejected_actions.push({ index, reason });
    }
  }
  return { pausedJobs, deniedSessions, revokedRoles, action_log, rejected_actions };
}

/**
 * Replay a frozen continuation after one submitted action plan. This function
 * returns final scorer evidence; the action tool must never return it during
 * triage or between commands.
 */
export function replayContainment(native, actions = []) {
  const { jobs, sessions } = validateNative(native);
  if (!Array.isArray(actions)) {
    throw new Error('actions must be an array');
  }
  const state = applyActions(native, actions, jobs, sessions);
  const attempts = [...native.attempts].sort(
    (left, right) =>
      left.event_time - right.event_time ||
      (left.kind === 'active' ? -1 : 1) - (right.kind === 'active' ? -1 : 1) ||
      left.attempt_id.localeCompare(right.attempt_id),
  );
  const authorization = new Map(
    attempts.map((attempt) => [
      attempt.attempt_id,
      authorizedAt(native, jobs.get(attempt.job_uid), attempt),
    ]),
  );
  const cleanJobs = new Set(
    native.jobs
      .filter((job) =>
        attempts
          .filter((attempt) => attempt.job_uid === job.job_uid)
          .every((attempt) => authorization.get(attempt.attempt_id)),
      )
      .map((job) => job.job_uid),
  );
  const attempt_results = attempts.map((attempt) => {
    const key = sessionKey(attempt.role_arn, attempt.role_session_name);
    const blocked_reason =
      attempt.kind === 'renewal'
        ? state.pausedJobs.has(attempt.job_uid)
          ? 'job-paused'
          : null
        : state.deniedSessions.has(key)
          ? 'exact-session-denied'
          : state.revokedRoles.has(attempt.role_arn)
            ? 'role-sessions-revoked'
            : null;
    return {
      attempt_id: attempt.attempt_id,
      job_uid: attempt.job_uid,
      kind: attempt.kind,
      event_time: attempt.event_time,
      authorized: authorization.get(attempt.attempt_id),
      completed: blocked_reason === null,
      ...(blocked_reason ? { blocked_reason } : {}),
    };
  });
  const unauthorized_completed = attempt_results.filter(
    (item) => item.completed && !item.authorized,
  ).length;
  const blocked_clean_attempts = attempt_results
    .filter((item) => cleanJobs.has(item.job_uid) && !item.completed)
    .map((item) => item.attempt_id);
  const threat_closed = unauthorized_completed === 0;
  const function_preserved = blocked_clean_attempts.length === 0;
  return {
    success: threat_closed && function_preserved && state.rejected_actions.length === 0,
    threat_closed,
    function_preserved,
    unauthorized_completed,
    blocked_clean_attempts,
    blocked_clean_attempt_count: blocked_clean_attempts.length,
    attempt_results,
    action_log: state.action_log,
    invalid_actions: state.rejected_actions.length,
    rejected_actions: state.rejected_actions,
  };
}
