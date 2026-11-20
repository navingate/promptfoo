import { isDeepStrictEqual } from 'node:util';

import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { resolveIndex } from '../v30/ledger.mjs';

const identity = {
  events: 'event_id',
  membership_audit: 'event_id',
  approval_publications: 'event_id',
  grant_snapshots: 'snapshot_ref',
  approval_snapshots: 'snapshot_ref',
  policy_snapshots: 'snapshot_ref',
  job_queue: 'job_uid',
  session_register: 'access_key_ref',
};

class Incomplete extends Error {}

function need(value) {
  if (!value) {
    throw new Incomplete();
  }
  return value;
}

function unique(items) {
  need(items.length === 1);
  return items[0];
}

function precedes(a, b) {
  return (
    Number.isSafeInteger(a.event_time) &&
    Number.isSafeInteger(b.event_time) &&
    Number.isSafeInteger(a.arrival_order) &&
    Number.isSafeInteger(b.arrival_order) &&
    a.event_time < b.event_time &&
    a.arrival_order < b.arrival_order
  );
}

// Detail replies carry no private request metadata. Identify their partition
// using the returned queue/register row or the redeemed release credential.
function detailKey(evidence) {
  if (evidence.job_queue?.length === 1) {
    return 'job:' + evidence.job_queue[0].job_uid;
  }
  if (evidence.session_register?.length === 1) {
    return 'session:' + evidence.session_register[0].access_key_ref;
  }
  if (Array.isArray(evidence.grant_snapshots)) {
    const ids = new Set(
      evidence.events
        ?.filter((event) => event.kind === 'release-token-redeemed')
        .map((event) => event.credential_id),
    );
    if (ids.size === 1) {
      return 'credential:' + [...ids][0];
    }
  }
  return null;
}

function detailsById(replies) {
  const details = new Map();
  const records = new Map();
  for (const reply of replies) {
    if (reply?.ok !== true || !reply.evidence || reply.evidence.archive) {
      continue;
    }
    const evidence = reply.evidence;
    for (const [collection, field] of Object.entries(identity)) {
      for (const row of evidence[collection] ?? []) {
        if (!row?.[field]) {
          throw new Error('prefix record lacks ' + field);
        }
        const recordKey = field + ':' + row[field];
        const existing = records.get(recordKey);
        if (existing && !isDeepStrictEqual(existing, row)) {
          throw new Error('conflicting prefix record ' + recordKey);
        }
        records.set(recordKey, row);
      }
    }
    const key = detailKey(evidence);
    if (key) {
      if (details.has(key) && !isDeepStrictEqual(details.get(key), evidence)) {
        throw new Error('conflicting prefix detail ' + key);
      }
      details.set(key, evidence);
    }
  }
  return details;
}

function covers(snapshot, audit, principal, action, resource, at, binding, trace) {
  need(snapshot.audit_stream_ref && Array.isArray(snapshot.grants) && Array.isArray(audit));
  return snapshot.grants.some((grant) => {
    const scope = grant.scope;
    if (
      !scope ||
      grant.task?.action !== action ||
      grant.task?.remote_ref !== resource ||
      !Number.isSafeInteger(scope.valid_from) ||
      !Number.isSafeInteger(scope.valid_until) ||
      !(scope.valid_from <= at && at < scope.valid_until) ||
      Object.entries(binding).some(([key, value]) => scope[key] !== value)
    ) {
      return false;
    }
    const writer = need(grant.writer_principal);
    if (writer === principal) {
      return true;
    }
    const matching = audit
      .filter(
        (e) =>
          e.audit_stream_ref === snapshot.audit_stream_ref &&
          e.group_principal === writer &&
          e.member_principal === principal &&
          e.outcome === 'completed' &&
          ['group-member-added', 'group-member-removed'].includes(e.kind) &&
          Number.isSafeInteger(e.event_time) &&
          Number.isSafeInteger(e.arrival_order) &&
          e.event_time < at,
      )
      .sort((a, b) => a.event_time - b.event_time || a.arrival_order - b.arrival_order);
    const latest = matching.at(-1);
    const previous = matching.at(-2);
    if (!latest) {
      return false;
    }
    need(
      !previous ||
        previous.event_time !== latest.event_time ||
        previous.arrival_order !== latest.arrival_order ||
        previous.kind === latest.kind,
    );
    trace.add(latest.event_id);
    return latest.kind === 'group-member-added';
  });
}

function sourceApproval(source, token, trace) {
  const events = need(source.events);
  need(token.actor && token.credential_id && token.credential_ref);
  const paths = [];
  // Revisions may be reused across objects and several fetches may name the
  // same credential. Bind and order the entire causal path before choosing.
  for (const read of events.filter(
    (e) =>
      e.kind === 'synced-secret-read' &&
      e.outcome === 'completed' &&
      e.actor === token.actor &&
      e.credential_id === token.credential_id &&
      precedes(e, token),
  )) {
    for (const fetch of events.filter(
      (e) =>
        e.kind === 'cloud-secret-attempt' &&
        e.outcome === 'completed' &&
        e.credential_id === token.credential_id &&
        e.credential_version === read.credential_version &&
        e.resource === token.credential_ref &&
        e.object_uid === read.object_uid &&
        e.object_name === read.object_name &&
        e.revision === read.revision &&
        precedes(e, read),
    )) {
      const lineage = events.filter(
        (e) =>
          e.object_uid === fetch.object_uid &&
          e.object_name === fetch.object_name &&
          e.revision === fetch.revision &&
          e.resource === fetch.resource &&
          precedes(e, fetch),
      );
      for (const reconcile of lineage.filter(
        (e) =>
          e.kind === 'controller-reconcile' &&
          e.outcome === 'completed' &&
          e.controller_id === fetch.controller_id,
      )) {
        for (const write of lineage.filter(
          (e) =>
            e.kind === 'object-spec-write' &&
            ['create', 'patch'].includes(e.verb) &&
            e.causal_ref &&
            e.causal_ref === reconcile.causal_ref &&
            precedes(e, reconcile),
        )) {
          paths.push({ read, fetch, reconcile, write });
        }
      }
    }
  }
  const { read, fetch, reconcile, write } = unique(paths);
  need(
    read.credential_version &&
      fetch.object_uid &&
      fetch.object_name &&
      Number.isSafeInteger(fetch.revision),
  );
  const snapshot = unique(
    need(source.grant_snapshots).filter((s) => s.snapshot_ref === fetch.grant_snapshot_ref),
  );
  for (const record of [read, fetch, reconcile, write]) {
    trace.add(record.event_id);
  }
  trace.add(snapshot.snapshot_ref);
  return covers(
    snapshot,
    source.membership_audit,
    need(write.actor),
    need(fetch.action),
    need(fetch.resource),
    fetch.event_time,
    { controller_id: need(fetch.controller_id) },
    trace,
  );
}

function issuedOwner(detail, register, trace, index) {
  need(
    register.liveness === 'live' &&
      register.revoked_at === null &&
      register.issued_at <= index.triage_time &&
      index.triage_time < register.expires_at,
  );
  const events = need(detail.events);
  const role = unique(
    events.filter(
      (e) =>
        e.kind === 'sts-assume-role' &&
        e.outcome === 'completed' &&
        e.access_key_ref === register.access_key_ref &&
        e.role_arn === register.role_arn &&
        e.role_session_name === register.role_session_name &&
        e.event_time <= register.issued_at,
    ),
  );
  need(role.source_access_key_ref && role.actor && role.session_policy_ref);
  const web = unique(
    events.filter(
      (e) =>
        e.kind === 'sts-assume-web-identity' &&
        e.outcome === 'completed' &&
        e.access_key_ref === role.source_access_key_ref &&
        e.role_arn === role.actor &&
        precedes(e, role),
    ),
  );
  need(web.role_session_name && web.actor);
  const request = unique(
    events.filter(
      (e) =>
        e.kind === 'runtime-credential-request' &&
        e.role_session_name === web.role_session_name &&
        e.actor === web.actor &&
        precedes(e, web),
    ),
  );
  need(request.pod_uid && request.service_account_id);
  const pod = unique(
    events.filter(
      (e) =>
        e.kind === 'pod-started' &&
        e.pod_uid === request.pod_uid &&
        e.service_account_id === request.service_account_id &&
        precedes(e, request),
    ),
  );
  for (const event of [role, web, request, pod]) {
    trace.add(event.event_id);
  }
  return { pod, role };
}

function jobLineage(job, uid, records) {
  const events = need(job.events);
  const submission = unique(events.filter((e) => e.kind === 'job-submitted' && e.job_uid === uid));
  const admission = unique(
    events.filter(
      (e) =>
        e.kind === 'job-admission' &&
        e.outcome === 'admitted' &&
        e.job_uid === uid &&
        e.causal_ref === submission.event_id &&
        e.actor === submission.actor &&
        e.namespace === submission.namespace &&
        precedes(submission, e),
    ),
  );
  const context = unique(
    events.filter(
      (e) =>
        e.event_id === submission.auth_context_ref &&
        ['release-token-redeemed', 'scheduled-job-authorized'].includes(e.kind) &&
        e.outcome === 'completed' &&
        e.granted_principal === submission.actor &&
        e.granted_namespace === submission.namespace &&
        precedes(e, submission),
    ),
  );
  for (const event of [submission, admission, context]) {
    records.add(event.event_id);
  }
  return { submission, admission, context };
}

function approvalLanes(job, submission, triageTime, records) {
  need(
    Array.isArray(job.approval_publications) &&
      Array.isArray(job.approval_snapshots) &&
      Array.isArray(job.membership_audit),
  );
  let approvals;
  try {
    approvals = resolveCurrentApprovals({ ...job, triage_time: triageTime });
  } catch {
    throw new Incomplete();
  }
  const published = new Set([submission.grant_snapshot_ref, submission.owner_snapshot_ref]);
  for (const proposal of job.approval_publications) {
    records.add(proposal.event_id);
    published.add(proposal.new_snapshot_ref);
  }
  for (const snap of job.approval_snapshots) {
    need(published.has(snap.snapshot_ref));
    records.add(snap.snapshot_ref);
  }
  return approvals;
}

// The published runtime policy is shared by all reads. Every current session
// returning it must identify the same snapshot before any phase is provable.
function runtimePolicyKey(accessKeyRefs, details) {
  const witnesses = new Map();
  for (const id of accessKeyRefs.toSorted()) {
    const key = 'session:' + id;
    for (const snapshot of details.get(key)?.policy_snapshots ?? []) {
      if (snapshot.kind === 'runtime-read-policy' && !witnesses.has(snapshot.snapshot_ref)) {
        witnesses.set(snapshot.snapshot_ref, key);
      }
    }
  }
  return witnesses.size === 1 ? witnesses.values().next().value : null;
}

function resolveSelector(index, details, policyKey, kind, id) {
  const dependencies = new Set();
  const missing = new Set();
  const records = new Set();
  const detail = (key) => {
    if (!details.has(key)) {
      missing.add(key);
      throw new Incomplete();
    }
    dependencies.add(key);
    return details.get(key);
  };
  let status = 'unresolved';
  try {
    const selected = detail(kind + ':' + id);
    const register = kind === 'session' ? unique(selected.session_register) : null;
    if (register) {
      records.add(register.access_key_ref);
    }
    const owner = register ? issuedOwner(selected, register, records, index) : null;
    const uid = owner ? need(owner.pod.owner_job_uid) : id;
    const job = detail('job:' + uid);
    const queued = unique(job.job_queue);
    records.add(queued.job_uid);
    const { submission, admission, context } = jobLineage(job, uid, records);
    if (owner) {
      need(
        owner.pod.service_account_id === submission.service_account_id &&
          owner.pod.service_account_name === submission.service_account_name &&
          owner.role.session_policy_ref === submission.session_policy_ref &&
          precedes(admission, owner.pod),
      );
    }
    need(context.event_time < index.triage_time);
    const sourceOK =
      context.kind === 'scheduled-job-authorized' ||
      sourceApproval(detail('credential:' + need(context.credential_id)), context, records);
    const approvals = approvalLanes(job, submission, index.triage_time, records);
    const plan = need(
      register ? register.active_plan : queued.credential_renewal_pending && queued.renewal_plan,
    );
    const at = plan.planned_at;
    need(Number.isSafeInteger(at) && index.triage_time < at && at <= index.horizon_end);
    need(policyKey);
    const policyDetail =
      register && selected.policy_snapshots?.some((s) => s.kind === 'runtime-read-policy')
        ? selected
        : detail(policyKey);
    const snapshot = unique(
      need(policyDetail.policy_snapshots).filter((s) => s.kind === 'runtime-read-policy'),
    );
    const policy = need(snapshot.policy);
    need(
      Number.isSafeInteger(policy.valid_from) &&
        Number.isSafeInteger(policy.valid_until) &&
        policy.policy_snapshot_ref === snapshot.snapshot_ref &&
        policy.role_arn &&
        (!register || register.role_arn === policy.role_arn) &&
        policy.actions?.includes(plan.action) &&
        policy.resources?.includes(plan.resource) &&
        policy.valid_from <= at &&
        at < policy.valid_until,
    );
    records.add(snapshot.snapshot_ref);
    const binding = {
      service_account_id: need(submission.service_account_id),
      template_id: need(submission.template_id),
    };
    need(approvals.length === 2);
    const approvalsOK = approvals.map((s) =>
      covers(
        s,
        job.membership_audit,
        need(submission.actor),
        plan.action,
        plan.resource,
        at,
        binding,
        records,
      ),
    );
    status = sourceOK && approvalsOK.every(Boolean) ? 'approved' : 'unsafe';
  } catch (error) {
    if (!(error instanceof Incomplete)) {
      throw error;
    }
  }
  return {
    status,
    dependencies: [...dependencies].sort(),
    missing_dependencies: [...missing].sort(),
    record_ids: [...records].sort(),
  };
}

/** Resolve each current renewal or active read from serialized successful detail replies. */
export function resolvePrefix(index, replies) {
  const current = resolveIndex(index);
  const details = detailsById(replies);
  const policyKey = runtimePolicyKey(current.access_key_refs, details);
  const result = {};
  for (const [kind, ids] of [
    ['job', current.job_uids],
    ['session', current.access_key_refs],
  ]) {
    for (const id of ids) {
      result[kind + ':' + id] = resolveSelector(index, details, policyKey, kind, id);
    }
  }
  return result;
}
