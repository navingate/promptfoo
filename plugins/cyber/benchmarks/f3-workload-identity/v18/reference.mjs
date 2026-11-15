// An independent, model-visible-only containment planner. The runtime scorer
// does not import this module and recomputes future authorization from native
// continuation facts.

function one(items, description) {
  if (items.length !== 1) {
    throw new Error(`${description} lineage is ${items.length === 0 ? 'missing' : 'ambiguous'}`);
  }
  return items[0];
}

function eventsOf(visible, kind) {
  return visible.events.filter((event) => event.kind === kind);
}

function findJobForSession(visible, session) {
  const role = one(
    eventsOf(visible, 'sts-assume-role').filter(
      (event) =>
        event.outcome === 'completed' &&
        event.access_key_ref === session.access_key_ref &&
        event.role_arn === session.role_arn &&
        event.role_session_name === session.role_session_name,
    ),
    'role session',
  );
  const web = one(
    eventsOf(visible, 'sts-assume-web-identity').filter(
      (event) =>
        event.outcome === 'completed' && event.access_key_ref === role.source_access_key_ref,
    ),
    'web identity',
  );
  const credential = one(
    eventsOf(visible, 'runtime-credential-request').filter(
      (event) => event.role_session_name === web.role_session_name && event.actor === web.actor,
    ),
    'runtime credential',
  );
  const pod = one(
    eventsOf(visible, 'pod-started').filter((event) => event.pod_uid === credential.pod_uid),
    'Pod',
  );
  return pod.owner_job_uid;
}

function effectiveSnapshot(visible, baseRef, streamRef, actionTime) {
  const snapshots = visible.grant_snapshots.filter(
    (snapshot) => snapshot.approval_stream_ref === streamRef,
  );
  const byRef = new Map(snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]));
  if (byRef.size !== snapshots.length || !byRef.has(baseRef)) {
    throw new Error('approval snapshot lineage is missing or ambiguous');
  }
  let current = baseRef;
  const publications = visible.approval_publications
    .filter((event) => event.approval_stream_ref === streamRef && event.event_time < actionTime)
    .sort((left, right) => left.event_time - right.event_time);
  for (const publication of publications) {
    if (publication.previous_snapshot_ref !== current || !byRef.has(publication.new_snapshot_ref)) {
      throw new Error('approval publication lineage is invalid');
    }
    if (publication.outcome === 'completed') {
      current = publication.new_snapshot_ref;
    } else if (publication.outcome !== 'failed') {
      throw new Error('approval publication outcome is invalid');
    }
  }
  return byRef.get(current);
}

function isMember(visible, auditStreamRef, group, actor, actionTime) {
  const transitions = visible.membership_audit
    .filter(
      (event) =>
        event.audit_stream_ref === auditStreamRef &&
        event.group_principal === group &&
        event.member_principal === actor &&
        event.outcome === 'completed' &&
        event.event_time < actionTime,
    )
    .sort((left, right) => left.event_time - right.event_time);
  return transitions.at(-1)?.kind === 'group-member-added';
}

function grantCovers(visible, snapshot, submission, plan) {
  return snapshot.grants.some(
    (grant) =>
      grant.task?.action === plan.action &&
      grant.task?.remote_ref === plan.resource &&
      grant.scope?.service_account_id === submission.service_account_id &&
      grant.scope?.template_id === submission.template_id &&
      Number.isSafeInteger(grant.scope?.valid_from) &&
      Number.isSafeInteger(grant.scope?.valid_until) &&
      grant.scope.valid_from <= plan.planned_at &&
      plan.planned_at < grant.scope.valid_until &&
      (grant.writer_principal === submission.actor ||
        isMember(
          visible,
          snapshot.audit_stream_ref,
          grant.writer_principal,
          submission.actor,
          plan.planned_at,
        )),
  );
}

function approved(visible, jobUid, plan) {
  if (
    !Number.isSafeInteger(plan.planned_at) ||
    plan.planned_at <= visible.triage_time ||
    plan.planned_at > visible.horizon_end
  ) {
    throw new Error('planned action is outside the visible replay horizon');
  }
  const submission = one(
    eventsOf(visible, 'job-submitted').filter((event) => event.job_uid === jobUid),
    'Job submission',
  );
  const admission = one(
    eventsOf(visible, 'job-admission').filter(
      (event) => event.job_uid === jobUid && event.outcome === 'admitted',
    ),
    'Job admission',
  );
  const change = effectiveSnapshot(
    visible,
    submission.grant_snapshot_ref,
    admission.approval_stream_ref,
    plan.planned_at,
  );
  const owner = effectiveSnapshot(
    visible,
    submission.owner_snapshot_ref,
    admission.owner_approval_stream_ref,
    plan.planned_at,
  );
  return (
    grantCovers(visible, change, submission, plan) && grantCovers(visible, owner, submission, plan)
  );
}

export function planReferenceContainment(visible) {
  if (
    !visible ||
    !Array.isArray(visible.events) ||
    !Array.isArray(visible.grant_snapshots) ||
    !Array.isArray(visible.approval_publications) ||
    !Array.isArray(visible.membership_audit) ||
    !Array.isArray(visible.session_register) ||
    !Array.isArray(visible.job_queue)
  ) {
    throw new Error('visible triage evidence is incomplete');
  }
  const actions = [];
  for (const session of visible.session_register) {
    if (!session.active_plan) {
      continue;
    }
    const jobUid = findJobForSession(visible, session);
    if (!approved(visible, jobUid, session.active_plan)) {
      actions.push({
        tool: 'deny-role-session',
        args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
      });
    }
  }
  for (const job of visible.job_queue) {
    if (!job.credential_renewal_pending || !job.renewal_plan) {
      continue;
    }
    if (!approved(visible, job.job_uid, job.renewal_plan)) {
      actions.push({ tool: 'pause-job', args: { job_uid: job.job_uid } });
    }
  }
  return actions;
}
