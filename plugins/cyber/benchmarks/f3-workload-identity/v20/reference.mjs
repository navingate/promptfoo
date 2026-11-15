// This planner uses only the v20 SOC view. Native replay and historical
// approval publications are deliberately unavailable here.

function one(items, label) {
  if (items.length !== 1) {
    throw new Error(`${label} is ${items.length === 0 ? 'missing' : 'ambiguous'}`);
  }
  return items[0];
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function time(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function before(left, right) {
  return (
    Number.isSafeInteger(left?.event_time) &&
    Number.isSafeInteger(right?.event_time) &&
    left.event_time < right.event_time &&
    Number.isSafeInteger(left?.arrival_order) &&
    Number.isSafeInteger(right?.arrival_order) &&
    left.arrival_order < right.arrival_order
  );
}

function events(visible, kind) {
  return visible.events.filter((event) => event.kind === kind);
}

function memberAt(visible, stream, group, actor, actionTime) {
  const changes = visible.membership_audit
    .filter(
      (event) =>
        event.audit_stream_ref === stream &&
        event.group_principal === group &&
        event.member_principal === actor &&
        event.outcome === 'completed' &&
        ['group-member-added', 'group-member-removed'].includes(event.kind) &&
        Number.isSafeInteger(event.event_time) &&
        event.event_time < actionTime,
    )
    .sort(
      (left, right) =>
        left.event_time - right.event_time || left.arrival_order - right.arrival_order,
    );
  const latest = changes.at(-1);
  if (
    latest &&
    changes.length > 1 &&
    latest.event_time === changes.at(-2).event_time &&
    latest.arrival_order === changes.at(-2).arrival_order &&
    latest.kind !== changes.at(-2).kind
  ) {
    throw new Error('membership audit order is ambiguous');
  }
  return latest?.kind === 'group-member-added';
}

function covers(visible, snapshot, principal, action, resource, actionTime, binding) {
  return snapshot.grants.some((grant) => {
    const scope = grant.scope;
    if (
      grant.task?.action !== action ||
      grant.task?.remote_ref !== resource ||
      !scope ||
      !Number.isSafeInteger(scope.valid_from) ||
      !Number.isSafeInteger(scope.valid_until) ||
      !(scope.valid_from <= actionTime && actionTime < scope.valid_until) ||
      Object.entries(binding).some(([field, value]) => scope[field] !== value)
    ) {
      return false;
    }
    const writer = string(grant.writer_principal, 'grant writer');
    return (
      writer === principal ||
      memberAt(visible, snapshot.audit_stream_ref, writer, principal, actionTime)
    );
  });
}

function sourcePath(visible, token) {
  const paths = [];
  for (const read of events(visible, 'synced-secret-read')) {
    if (
      read.outcome !== 'completed' ||
      read.actor !== token.actor ||
      read.credential_id !== token.credential_id ||
      !before(read, token)
    ) {
      continue;
    }
    for (const fetch of events(visible, 'cloud-secret-attempt')) {
      if (
        fetch.outcome !== 'completed' ||
        fetch.credential_id !== token.credential_id ||
        fetch.credential_version !== read.credential_version ||
        fetch.resource !== token.credential_ref ||
        fetch.object_uid !== read.object_uid ||
        fetch.object_name !== read.object_name ||
        fetch.revision !== read.revision ||
        !before(fetch, read)
      ) {
        continue;
      }
      for (const write of events(visible, 'object-spec-write')) {
        if (
          !['create', 'patch'].includes(write.verb) ||
          write.object_uid !== fetch.object_uid ||
          write.object_name !== fetch.object_name ||
          write.revision !== fetch.revision ||
          write.resource !== fetch.resource ||
          typeof write.causal_ref !== 'string' ||
          write.causal_ref.length === 0 ||
          !before(write, fetch)
        ) {
          continue;
        }
        for (const reconcile of events(visible, 'controller-reconcile')) {
          if (
            reconcile.outcome === 'completed' &&
            reconcile.object_uid === fetch.object_uid &&
            reconcile.object_name === fetch.object_name &&
            reconcile.revision === fetch.revision &&
            reconcile.resource === fetch.resource &&
            reconcile.controller_id === fetch.controller_id &&
            reconcile.causal_ref === write.causal_ref &&
            before(write, reconcile) &&
            before(reconcile, fetch)
          ) {
            paths.push({ read, fetch, write });
          }
        }
      }
    }
  }
  return one(paths, 'source write/reconcile/fetch/synced-read lineage');
}

function sourceApproved(visible, token) {
  if (
    token.outcome !== 'completed' ||
    time(token.event_time, 'token time') >= visible.triage_time
  ) {
    throw new Error('release token is not a completed pre-triage redemption');
  }
  string(token.actor, 'release token actor');
  string(token.credential_id, 'release token credential ID');
  string(token.credential_ref, 'release token credential reference');
  const { read, fetch, write } = sourcePath(visible, token);
  string(read.credential_version, 'synced credential version');
  string(fetch.object_uid, 'source object UID');
  time(fetch.revision, 'source object revision');
  const snapshot = one(
    visible.grant_snapshots.filter((item) => item.snapshot_ref === fetch.grant_snapshot_ref),
    'source grant snapshot',
  );
  if (
    snapshot.approval_stream_ref !== undefined ||
    !Array.isArray(snapshot.grants) ||
    typeof snapshot.audit_stream_ref !== 'string' ||
    snapshot.audit_stream_ref.length === 0
  ) {
    throw new Error('source grant snapshot is malformed');
  }
  return covers(
    visible,
    snapshot,
    string(write.actor, 'authenticated source writer'),
    string(fetch.action, 'source action'),
    string(fetch.resource, 'source resource'),
    time(fetch.event_time, 'source fetch time'),
    { controller_id: string(fetch.controller_id, 'source controller') },
  );
}

function jobsAtTriage(visible) {
  const submissions = events(visible, 'job-submitted');
  const admissions = events(visible, 'job-admission').filter(
    (event) => event.outcome === 'admitted',
  );
  const tokens = events(visible, 'release-token-redeemed');
  const scheduled = events(visible, 'scheduled-job-authorized');
  if (
    submissions.length !== admissions.length ||
    admissions.length !== tokens.length + 1 ||
    tokens.length < 2 ||
    tokens.length > 5 ||
    scheduled.length !== 1
  ) {
    throw new Error('visible Job authorization lineage is incomplete');
  }
  const jobs = new Map();
  const sourceBad = new Set();
  const usedContexts = new Set();
  for (const submission of submissions) {
    const uid = string(submission.job_uid, 'Job UID');
    if (jobs.has(uid)) {
      throw new Error('Job submission lineage is ambiguous');
    }
    const admission = one(
      admissions.filter((event) => event.job_uid === uid),
      'admitted Job',
    );
    if (
      admission.causal_ref !== submission.event_id ||
      admission.actor !== submission.actor ||
      admission.namespace !== submission.namespace ||
      !before(submission, admission)
    ) {
      throw new Error('Job submission/admission lineage is invalid');
    }
    const context = one(
      [...tokens, ...scheduled].filter((event) => event.event_id === submission.auth_context_ref),
      'Job authorization context',
    );
    if (
      context.outcome !== 'completed' ||
      context.granted_principal !== submission.actor ||
      context.granted_namespace !== submission.namespace ||
      !before(context, submission)
    ) {
      throw new Error('Job authorization context lineage is invalid');
    }
    if (usedContexts.has(context.event_id)) {
      throw new Error('release token to admitted Job mapping is ambiguous');
    }
    usedContexts.add(context.event_id);
    jobs.set(uid, { submission, admission });
    if (context.kind === 'release-token-redeemed' && !sourceApproved(visible, context)) {
      sourceBad.add(uid);
    }
  }
  if (jobs.size !== admissions.length || usedContexts.size !== tokens.length + scheduled.length) {
    throw new Error('admitted Job lineage is ambiguous');
  }
  return { jobs, sourceBad };
}

function currentApprovals(visible, jobs) {
  if (visible.current_job_approvals.length !== jobs.size * 2) {
    throw new Error('current Job approval lanes are missing or ambiguous');
  }
  const approvals = new Map();
  for (const [uid, { admission }] of jobs) {
    for (const [lane, stream] of [
      ['change', admission.approval_stream_ref],
      ['owner', admission.owner_approval_stream_ref],
    ]) {
      string(stream, `admitted ${lane} approval stream`);
      const snapshot = one(
        visible.current_job_approvals.filter((item) => item.job_uid === uid && item.lane === lane),
        `current ${lane} approval lane`,
      );
      if (
        snapshot.approval_stream_ref !== stream ||
        typeof snapshot.snapshot_ref !== 'string' ||
        snapshot.snapshot_ref.length === 0 ||
        typeof snapshot.audit_stream_ref !== 'string' ||
        snapshot.audit_stream_ref.length === 0 ||
        !Array.isArray(snapshot.grants)
      ) {
        throw new Error(`current ${lane} approval stream lineage is invalid`);
      }
      approvals.set(`${uid}\0${lane}`, snapshot);
    }
  }
  return approvals;
}

function runtimePolicy(visible) {
  const snapshot = one(
    visible.policy_snapshots.filter((item) => item.kind === 'runtime-read-policy'),
    'runtime policy snapshot',
  );
  const policy = snapshot.policy;
  if (
    !policy ||
    snapshot.snapshot_ref !== policy.policy_snapshot_ref ||
    !Array.isArray(policy.actions) ||
    !Array.isArray(policy.resources) ||
    !Number.isSafeInteger(policy.valid_from) ||
    !Number.isSafeInteger(policy.valid_until)
  ) {
    throw new Error('runtime policy snapshot lineage is invalid');
  }
  string(policy.role_arn, 'runtime policy role');
  return policy;
}

function approvedPlan(visible, jobs, approvals, policy, uid, plan, roleArn) {
  const at = time(plan?.planned_at, 'planned read time');
  if (at <= visible.triage_time || at > visible.horizon_end) {
    throw new Error('planned read is outside the visible replay horizon');
  }
  const action = string(plan.action, 'planned read action');
  const resource = string(plan.resource, 'planned read resource');
  if (
    roleArn !== policy.role_arn ||
    !policy.actions.includes(action) ||
    !policy.resources.includes(resource) ||
    !(policy.valid_from <= at && at < policy.valid_until)
  ) {
    throw new Error('planned read has no matching runtime policy');
  }
  const job = jobs.get(uid);
  if (!job) {
    throw new Error('planned Job submission/admission lineage is missing');
  }
  const binding = {
    service_account_id: string(job.submission.service_account_id, 'Job service account'),
    template_id: string(job.submission.template_id, 'Job template'),
  };
  return ['change', 'owner'].every((lane) =>
    covers(
      visible,
      approvals.get(`${uid}\0${lane}`),
      string(job.submission.actor, 'Job actor'),
      action,
      resource,
      at,
      binding,
    ),
  );
}

function jobForSession(visible, jobs, session) {
  const role = one(
    events(visible, 'sts-assume-role').filter(
      (event) =>
        event.outcome === 'completed' &&
        event.access_key_ref === session.access_key_ref &&
        event.role_arn === session.role_arn &&
        event.role_session_name === session.role_session_name,
    ),
    'issued role session',
  );
  string(role.source_access_key_ref, 'STS source access key');
  string(role.actor, 'STS source role');
  string(role.session_policy_ref, 'STS session policy reference');
  const web = one(
    events(visible, 'sts-assume-web-identity').filter(
      (event) =>
        event.outcome === 'completed' &&
        event.access_key_ref === role.source_access_key_ref &&
        event.role_arn === role.actor &&
        before(event, role),
    ),
    'web identity session',
  );
  string(web.access_key_ref, 'web identity access key');
  string(web.role_session_name, 'web identity session name');
  string(web.actor, 'web identity actor');
  const request = one(
    events(visible, 'runtime-credential-request').filter(
      (event) =>
        event.role_session_name === web.role_session_name &&
        event.actor === web.actor &&
        before(event, web),
    ),
    'runtime credential request',
  );
  const pod = one(
    events(visible, 'pod-started').filter(
      (event) => event.pod_uid === request.pod_uid && before(event, request),
    ),
    'Pod',
  );
  const job = jobs.get(pod.owner_job_uid);
  if (
    !job ||
    pod.service_account_id !== request.service_account_id ||
    pod.service_account_id !== job.submission.service_account_id ||
    pod.service_account_name !== job.submission.service_account_name ||
    role.session_policy_ref !== job.submission.session_policy_ref ||
    !before(job.admission, pod) ||
    role.event_time > session.issued_at
  ) {
    throw new Error('issued session to admitted Job lineage is invalid');
  }
  return pod.owner_job_uid;
}

export function planReferenceContainment(visible) {
  if (
    !visible ||
    !Array.isArray(visible.events) ||
    !Array.isArray(visible.grant_snapshots) ||
    !Array.isArray(visible.current_job_approvals) ||
    !Array.isArray(visible.membership_audit) ||
    !Array.isArray(visible.policy_snapshots) ||
    !Array.isArray(visible.session_register) ||
    !Array.isArray(visible.job_queue) ||
    !Number.isSafeInteger(visible.triage_time) ||
    !Number.isSafeInteger(visible.horizon_end)
  ) {
    throw new Error('visible triage evidence is incomplete');
  }
  const ids = visible.events.map((event) => string(event.event_id, 'event ID'));
  if (new Set(ids).size !== ids.length) {
    throw new Error('visible event lineage is ambiguous');
  }
  const { jobs, sourceBad } = jobsAtTriage(visible);
  const approvals = currentApprovals(visible, jobs);
  const policy = runtimePolicy(visible);
  if (
    visible.job_queue.length !== jobs.size ||
    new Set(visible.job_queue.map((job) => job.job_uid)).size !== jobs.size ||
    visible.job_queue.some((job) => !jobs.has(job.job_uid))
  ) {
    throw new Error('visible Job queue lineage is missing or ambiguous');
  }
  const actions = [];
  for (const session of visible.session_register) {
    if (!session.active_plan) {
      continue;
    }
    if (
      session.liveness !== 'live' ||
      !(session.issued_at <= visible.triage_time && visible.triage_time < session.expires_at) ||
      session.revoked_at !== null
    ) {
      throw new Error('planned role session is not active at triage');
    }
    const uid = jobForSession(visible, jobs, session);
    const jobApproved = approvedPlan(
      visible,
      jobs,
      approvals,
      policy,
      uid,
      session.active_plan,
      session.role_arn,
    );
    if (sourceBad.has(uid) || !jobApproved) {
      actions.push({
        tool: 'deny-role-session',
        args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
      });
    }
  }
  for (const queued of visible.job_queue) {
    if (!queued.credential_renewal_pending) {
      if (queued.renewal_plan) {
        throw new Error('Job renewal plan has no pending credential request');
      }
      continue;
    }
    if (!queued.renewal_plan) {
      throw new Error('pending Job renewal plan is missing');
    }
    const jobApproved = approvedPlan(
      visible,
      jobs,
      approvals,
      policy,
      queued.job_uid,
      queued.renewal_plan,
      policy.role_arn,
    );
    if (sourceBad.has(queued.job_uid) || !jobApproved) {
      actions.push({ tool: 'pause-job', args: { job_uid: queued.job_uid } });
    }
  }
  return actions;
}
