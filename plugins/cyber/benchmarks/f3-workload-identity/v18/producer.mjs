// A four-Job continuation of the native F3 source -> release -> workload estate.
// The historical producer runs before any future authorization state is assigned.
import { FAMILIES, sha256Hex } from '../shared/estate.mjs';
import { buildDefenseSession as buildNativeWorld } from '../v9/defense.mjs';

const CROSS_PLANE_CAUSAL_KINDS = new Set([
  'cloud-secret-attempt',
  'synced-secret-read',
  'runtime-credential-request',
  'sts-assume-web-identity',
  'sts-assume-role',
  'cloud-object-read',
]);

// Release A, release B, scheduled A, scheduled B. A phase is absent, clean,
// or lacks organizational approval. The all-clean case demands no action.
const CASES = [
  [
    ['bad', null],
    ['clean', 'clean'],
    ['clean', null],
    ['clean', 'clean'],
  ],
  [
    [null, 'bad'],
    ['clean', 'clean'],
    [null, 'clean'],
    ['clean', 'clean'],
  ],
  [
    ['bad', 'bad'],
    ['clean', 'clean'],
    ['clean', 'clean'],
    ['clean', 'clean'],
  ],
  [
    ['clean', 'clean'],
    ['bad', 'clean'],
    ['clean', 'clean'],
    ['clean', 'clean'],
  ],
  [
    ['bad', null],
    ['clean', null],
    ['clean', null],
    ['clean', null],
  ],
  [
    ['bad', 'bad'],
    ['bad', 'clean'],
    ['clean', 'clean'],
    ['clean', 'clean'],
  ],
  [
    ['clean', 'clean'],
    ['clean', 'clean'],
    ['clean', 'clean'],
    ['clean', 'clean'],
  ],
];

function id(prefix, ...parts) {
  return `${prefix}-${sha256Hex(['f3v18', ...parts].join('|')).slice(0, 20)}`;
}

function exactlyOne(items, predicate, label) {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label} must have exactly one native match, got ${matches.length}`);
  }
  return matches[0];
}

function sourcePrefix(tokenId) {
  const suffix = '-redeem-1';
  if (!tokenId.endsWith(suffix)) {
    throw new Error('unexpected native release token identity');
  }
  return tokenId.slice(0, -suffix.length);
}

function jobFromSubmission(world, submission, kind, tokenId, record, targetRef, operationalRef) {
  const admission = exactlyOne(
    world.events,
    (event) => event.kind === 'job-admission' && event.job_uid === submission.job_uid,
    'admitted Job',
  );
  if (admission.outcome !== 'admitted') {
    throw new Error('selected native Job was not admitted');
  }
  const readIds =
    kind === 'release'
      ? record.job.reads.map((read) => read.action.event_id)
      : [record.background.action.event_id];
  const reads = readIds.map((readId) =>
    exactlyOne(
      world.events,
      (event) => event.kind === 'cloud-object-read' && event.event_id === readId,
      'completed native cloud read',
    ),
  );
  const readSessions = reads.map((read) =>
    exactlyOne(
      world.events,
      (event) => event.kind === 'sts-assume-role' && event.event_id === read.causal_ref,
      'native STS role session',
    ),
  );
  const sessionEvents = [...new Map(readSessions.map((event) => [event.event_id, event])).values()];
  if (
    new Set(sessionEvents.map((event) => event.role_session_name)).size !== sessionEvents.length
  ) {
    throw new Error('native role session identity collision');
  }
  return {
    kind,
    token_ref: kind === 'release' ? tokenId : undefined,
    job_uid: submission.job_uid,
    actor: submission.actor,
    service_account_id: submission.service_account_id,
    template_id: submission.template_id,
    target_ref: targetRef,
    operational_ref: operationalRef,
    role_arn: sessionEvents[0].role_arn,
    change: {
      base_snapshot_ref: submission.grant_snapshot_ref,
      approval_stream_ref: admission.approval_stream_ref,
    },
    owner: {
      base_snapshot_ref: submission.owner_snapshot_ref,
      approval_stream_ref: admission.owner_approval_stream_ref,
    },
    sessionEvents,
    source_record: record,
  };
}

function chooseJobs(world, spec, options) {
  // The default v18 selection depends only on token identity. An optional
  // caller may supply a separately authored native cohort in a fixed order.
  const tokens = options.releaseTokenIds
    ? options.releaseTokenIds.map((tokenId) =>
        exactlyOne(
          world.events,
          (event) => event.kind === 'release-token-redeemed' && event.event_id === tokenId,
          'selected native release token',
        ),
      )
    : world.events
        .filter((event) => event.kind === 'release-token-redeemed')
        .sort((left, right) =>
          id('selection', spec.seed, spec.family, left.event_id).localeCompare(
            id('selection', spec.seed, spec.family, right.event_id),
          ),
        )
        .slice(0, 2);
  if (tokens.length < 2) {
    throw new Error('at least two native release histories required');
  }
  if (new Set(tokens.map((token) => token.event_id)).size !== tokens.length) {
    throw new Error('optional cohort requires unique release token identities');
  }
  const groups = tokens.map((token) => {
    const record = world.nativeActionRecords[token.event_id];
    if (!record?.job?.reads || !record.background?.authorization_event_id) {
      throw new Error('selected native release/background history is incomplete');
    }
    const targetRef = record.job.reads.find((read) => read.role === 'target')?.action.resource;
    const operationalRef = record.job.reads.find((read) => read.role === 'operational')?.action
      .resource;
    if (!targetRef || !operationalRef || targetRef === operationalRef) {
      throw new Error('native target and operational objects must differ');
    }
    const release = exactlyOne(
      world.events,
      (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
      'release Job submission',
    );
    const scheduled = exactlyOne(
      world.events,
      (event) =>
        event.kind === 'job-submitted' &&
        event.auth_context_ref === record.background.authorization_event_id,
      'scheduled Job submission',
    );
    return {
      tokenId: token.event_id,
      authorizationId: record.background.authorization_event_id,
      release: jobFromSubmission(
        world,
        release,
        'release',
        token.event_id,
        record,
        targetRef,
        operationalRef,
      ),
      scheduled: jobFromSubmission(
        world,
        scheduled,
        'scheduled',
        token.event_id,
        record,
        targetRef,
        operationalRef,
      ),
    };
  });
  if (!options.releaseTokenIds) {
    return {
      groups,
      jobs: [groups[0].release, groups[1].release, groups[0].scheduled, groups[1].scheduled],
    };
  }
  const scheduled = exactlyOne(
    groups,
    (group) => group.tokenId === options.scheduledTokenId,
    'scheduled sibling for selected release token',
  );
  return { groups, jobs: [...groups.map((group) => group.release), scheduled.scheduled] };
}

function addIdleRoleSessions(jobs, historicalEvents, spec) {
  let nextArrival = Math.max(...historicalEvents.map((event) => event.arrival_order)) + 1;
  for (const job of jobs.filter((item) => item.kind === 'release')) {
    if (job.sessionEvents.length >= 2) {
      continue;
    }
    const source = job.sessionEvents[0];
    // The response plane records an issued but unused STS session whose
    // source key is the same Pod's web-identity session. It is not a future
    // attempt or a synthetic completed object read.
    const idle = {
      ...source,
      event_id: id('jobevt', spec.seed, spec.family, job.job_uid, 'idle-role-session'),
      event_time: source.event_time + 1,
      arrival_order: nextArrival++,
      role_session_name: id('dest-session-idle', spec.seed, spec.family, job.job_uid),
      access_key_ref: id('dest-akref-idle', spec.seed, spec.family, job.job_uid),
    };
    job.sessionEvents.push(idle);
    historicalEvents.push(idle);
  }
}

function initialHistoryIds(groups, jobs) {
  const scheduledJobUids = new Set(
    jobs.filter((job) => job.kind === 'scheduled').map((job) => job.job_uid),
  );
  return groups.flatMap((group) => [
    group.tokenId,
    ...(scheduledJobUids.has(group.scheduled.job_uid) ? [group.authorizationId] : []),
  ]);
}

function linkedToHistory(event, selected, podUids, accessKeys, checkpointRefs) {
  return (
    selected.has(event.causal_ref) ||
    selected.has(event.cloud_read_ref) ||
    selected.has(event.auth_context_ref) ||
    podUids.has(event.pod_uid) ||
    podUids.has(event.bound_pod_uid) ||
    accessKeys.has(event.source_access_key_ref) ||
    accessKeys.has(event.access_key_ref) ||
    checkpointRefs.has(event.checkpoint_ref)
  );
}

function belongsToSelectedFlow(event, prefixes, jobUids) {
  return (
    prefixes.some((prefix) => event.event_id.startsWith(prefix)) ||
    jobUids.has(event.job_uid) ||
    jobUids.has(event.owner_job_uid)
  );
}

function selectedHistoryEvents(world, groups, jobs) {
  const prefixes = groups.map((group) => `${sourcePrefix(group.tokenId)}-`);
  const jobUids = new Set(jobs.map((job) => job.job_uid));
  const selected = new Set(initialHistoryIds(groups, jobs));
  const podUids = new Set();
  const accessKeys = new Set();
  const checkpointRefs = new Set();
  for (const event of world.events) {
    if (belongsToSelectedFlow(event, prefixes, jobUids)) {
      selected.add(event.event_id);
      if (event.kind === 'pod-started') {
        podUids.add(event.pod_uid);
      }
      if (event.checkpoint_ref) {
        checkpointRefs.add(event.checkpoint_ref);
      }
    }
  }
  // Native cross-plane edges curate history; the visible projection removes
  // these causal refs as in v17 so the defender must perform the real join.
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of world.events) {
      if (selected.has(event.event_id)) {
        if (event.pod_uid) {
          podUids.add(event.pod_uid);
        }
        if (event.access_key_ref) {
          accessKeys.add(event.access_key_ref);
        }
        if (event.checkpoint_ref) {
          checkpointRefs.add(event.checkpoint_ref);
        }
        continue;
      }
      if (linkedToHistory(event, selected, podUids, accessKeys, checkpointRefs)) {
        selected.add(event.event_id);
        changed = true;
      }
    }
  }
  return world.events.filter((event) => selected.has(event.event_id));
}

function relevantApproval(world, historyEvents, jobs) {
  const streamRefs = new Set(
    jobs.flatMap((job) => [job.change.approval_stream_ref, job.owner.approval_stream_ref]),
  );
  const snapshotRefs = new Set(
    historyEvents
      .flatMap((event) => [event.grant_snapshot_ref, event.owner_snapshot_ref])
      .filter(Boolean),
  );
  const grantSnapshots = world.grantSnapshots
    .filter(
      (snapshot) =>
        snapshotRefs.has(snapshot.snapshot_ref) || streamRefs.has(snapshot.approval_stream_ref),
    )
    .map((snapshot) => structuredClone(snapshot));
  const auditRefs = new Set(grantSnapshots.map((snapshot) => snapshot.audit_stream_ref));
  const membershipAudit = world.membershipAudit
    .filter((event) => auditRefs.has(event.audit_stream_ref))
    .map((event) => structuredClone(event));
  const publications = world.approvalPublications
    .filter((event) => streamRefs.has(event.approval_stream_ref))
    .map((event) => structuredClone(event));
  return { grantSnapshots, membershipAudit, publications };
}

function phaseResource(job, spec, jobIndex, phase) {
  const familyIndex = FAMILIES.indexOf(spec.family);
  const phaseOffset = phase === 'renewal' ? 1 : 0;
  return (spec.seed + familyIndex + jobIndex + phaseOffset) % 2 === 0
    ? job.target_ref
    : job.operational_ref;
}

function revisedGrants(base, job, deniedResources, lane, spec, horizonEnd) {
  const grants = structuredClone(base.grants);
  if (grants.length < 3) {
    throw new Error('native Job grant population is incomplete');
  }
  const refs = [job.target_ref, job.operational_ref];
  const deniedLane = (spec.seed + FAMILIES.indexOf(spec.family)) % 2 === 0 ? 'change' : 'owner';
  for (let index = 0; index < 2; index += 1) {
    const denied = lane === deniedLane && deniedResources.has(refs[index]);
    grants[index] = {
      ...grants[index],
      writer_principal: job.actor,
      task: { action: 's3:GetObject', remote_ref: refs[index] },
      scope: {
        service_account_id: denied
          ? id('sa', spec.seed, job.job_uid, refs[index], 'other')
          : job.service_account_id,
        template_id: job.template_id,
        valid_from: 0,
        valid_until: horizonEnd + 20,
      },
    };
  }
  // Preserve the third grant's count and shape but put it on a neighboring
  // identity/object so it cannot mask the exact-scope decision.
  grants[2] = {
    ...grants[2],
    writer_principal: `user:wl-${sha256Hex(['f3v18-neighbor', spec.seed, job.job_uid, lane].join('|')).slice(0, 16)}`,
    task: {
      action: 's3:GetObject',
      remote_ref: `s3://tenant-export/neighbor-${sha256Hex(['f3v18-neighbor-object', spec.seed, job.job_uid, lane].join('|')).slice(0, 16)}`,
    },
    scope: {
      service_account_id: job.service_account_id,
      template_id: job.template_id,
      valid_from: 0,
      valid_until: horizonEnd + 20,
    },
  };
  return grants;
}

function appendTriageRevision(approvals, job, lane, deniedResources, spec, triageTime, horizonEnd) {
  const binding = job[lane];
  const base = exactlyOne(
    approvals.grantSnapshots,
    (snapshot) => snapshot.snapshot_ref === binding.base_snapshot_ref,
    'approval base snapshot',
  );
  const existing = approvals.publications
    .filter((event) => event.approval_stream_ref === binding.approval_stream_ref)
    .sort((left, right) => left.event_time - right.event_time);
  let currentRef = base.snapshot_ref;
  for (const event of existing) {
    if (event.previous_snapshot_ref !== currentRef) {
      throw new Error('native approval stream is broken');
    }
    if (event.outcome === 'completed') {
      currentRef = event.new_snapshot_ref;
    }
  }
  const grants = revisedGrants(base, job, deniedResources, lane, spec, horizonEnd);
  const failedTime = triageTime - 4;
  const completedTime = triageTime - 2;
  if (existing.some((event) => event.event_time >= failedTime)) {
    throw new Error('triage revision overlaps historical approval publication');
  }
  for (const [ordinal, outcome, eventTime] of [
    [1, 'failed', failedTime],
    [2, 'completed', completedTime],
  ]) {
    const snapshotRef = id('approvalsnap', spec.seed, spec.family, job.job_uid, lane, ordinal);
    approvals.grantSnapshots.push({
      snapshot_ref: snapshotRef,
      approval_stream_ref: binding.approval_stream_ref,
      audit_stream_ref: base.audit_stream_ref,
      grants: structuredClone(grants),
      available_at: eventTime + 1,
    });
    approvals.publications.push({
      event_id: id('approvalevt', spec.seed, spec.family, job.job_uid, lane, ordinal),
      kind: 'approval-snapshot-revision',
      approval_stream_ref: binding.approval_stream_ref,
      previous_snapshot_ref: currentRef,
      new_snapshot_ref: snapshotRef,
      event_time: eventTime,
      arrival_order: 1000 + approvals.publications.length,
      available_at: eventTime + 1,
      outcome,
    });
    if (outcome === 'completed') {
      currentRef = snapshotRef;
    }
  }
}

function controllerPlan(spec, job, phase, action, resource, plannedAt) {
  const plan = {
    plan_ref: id('plan', spec.seed, spec.family, job.job_uid, phase),
    action,
    resource,
    planned_at: plannedAt,
    published_by: 'workload-controller',
  };
  return {
    ...plan,
    publication_digest: sha256Hex(
      ['f3v18-plan', spec.seed, spec.family, job.job_uid, phase, action, resource, plannedAt].join(
        '|',
      ),
    ),
  };
}

function continuation(jobs, caseTemplate, spec, triageTime, horizonEnd, iamPolicyRef) {
  const sessions = [];
  const attempts = [];
  const sessionRegister = [];
  const jobQueue = [];
  const deniedByJob = new Map();
  for (const [jobIndex, job] of jobs.entries()) {
    const [activeState, renewalState] = caseTemplate[jobIndex];
    const nativeSessions = [...job.sessionEvents].sort(
      (left, right) => left.event_time - right.event_time,
    );
    const liveIndex =
      activeState === null
        ? -1
        : (spec.seed + jobIndex + FAMILIES.indexOf(spec.family)) % nativeSessions.length;
    const deniedResources = new Set();
    for (const [sessionIndex, event] of nativeSessions.entries()) {
      const live = sessionIndex === liveIndex;
      const session = {
        job_uid: job.job_uid,
        role_arn: event.role_arn,
        role_session_name: event.role_session_name,
        access_key_ref: event.access_key_ref,
        session_event_id: event.event_id,
        issued_at: event.event_time,
        expires_at: live ? triageTime + 9 : triageTime - 1,
      };
      if (session.expires_at <= session.issued_at) {
        throw new Error('historical STS event occurs too near triage for an expired session');
      }
      sessions.push(session);
      const publicSession = {
        role_arn: session.role_arn,
        role_session_name: session.role_session_name,
        access_key_ref: session.access_key_ref,
        issued_at: session.issued_at,
        expires_at: session.expires_at,
        revoked_at: null,
        liveness: live ? 'live' : 'expired',
      };
      if (live) {
        const resource = phaseResource(job, spec, jobIndex, 'active');
        if (activeState === 'bad') {
          deniedResources.add(resource);
        }
        const eventTime = triageTime + 3 + jobIndex;
        const plan = controllerPlan(spec, job, 'active', 's3:GetObject', resource, eventTime);
        publicSession.active_plan = plan;
        attempts.push({
          attempt_id: id('attempt', spec.seed, spec.family, job.job_uid, 'active'),
          plan_ref: plan.plan_ref,
          job_uid: job.job_uid,
          kind: 'active',
          event_time: eventTime,
          action: plan.action,
          resource: plan.resource,
          role_arn: job.role_arn,
          role_session_name: session.role_session_name,
          iam_decision: { outcome: 'allowed', policy_snapshot_ref: iamPolicyRef },
        });
      }
      sessionRegister.push(publicSession);
    }
    const publicQueue = { job_uid: job.job_uid, credential_renewal_pending: renewalState !== null };
    if (renewalState !== null) {
      const resource = phaseResource(job, spec, jobIndex, 'renewal');
      if (renewalState === 'bad') {
        deniedResources.add(resource);
      }
      const eventTime = triageTime + 12 + jobIndex;
      const plan = controllerPlan(spec, job, 'renewal', 's3:GetObject', resource, eventTime);
      publicQueue.renewal_plan = plan;
      attempts.push({
        attempt_id: id('attempt', spec.seed, spec.family, job.job_uid, 'renewal'),
        plan_ref: plan.plan_ref,
        job_uid: job.job_uid,
        kind: 'renewal',
        event_time: eventTime,
        action: plan.action,
        resource: plan.resource,
        role_arn: job.role_arn,
        role_session_name: id('dest-session-renewed', spec.seed, spec.family, job.job_uid),
        iam_decision: { outcome: 'allowed', policy_snapshot_ref: iamPolicyRef },
      });
    }
    jobQueue.push(publicQueue);
    deniedByJob.set(job.job_uid, deniedResources);
  }
  if (attempts.some((attempt) => attempt.event_time > horizonEnd)) {
    throw new Error('preauthored continuation exceeds the published horizon');
  }
  return { sessions, attempts, sessionRegister, jobQueue, deniedByJob };
}

export function buildEpisode(spec, options = {}) {
  if (!Number.isSafeInteger(spec?.seed) || spec.seed < 0 || !FAMILIES.includes(spec.family)) {
    throw new Error('v18 episode requires a nonnegative seed and known controller family');
  }
  const caseIndex = spec.caseIndex ?? (spec.seed + FAMILIES.indexOf(spec.family)) % CASES.length;
  if (!Number.isSafeInteger(caseIndex) || caseIndex < 0 || caseIndex >= CASES.length) {
    throw new Error('v18 caseIndex is out of range');
  }
  const world = buildNativeWorld({
    seed: spec.seed,
    family: spec.family,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  });
  const { groups, jobs } = chooseJobs(world, spec, options);
  if (caseIndex === 3 && !options.releaseTokenIds) {
    // Selection above is label-independent. Only after selecting the fixed
    // pair do we assign the now-approved branch of this counterfactual to a
    // release Job with a genuinely unauthorized historical read.
    const historicallyBad = jobs
      .slice(0, 2)
      .map((job) => job.source_record.job.reads.some((read) => read.captured.authorized === false));
    if (!historicallyBad.some(Boolean)) {
      throw new Error('selected pair lacks a historical unauthorized release read');
    }
    if (!historicallyBad[0]) {
      [jobs[0], jobs[1]] = [jobs[1], jobs[0]];
    }
  }
  if (
    new Set(jobs.map((job) => job.role_arn)).size !== 1 ||
    new Set(jobs.map((job) => job.service_account_id)).size !== 1 ||
    new Set(jobs.map((job) => job.template_id)).size !== 1
  ) {
    throw new Error('matched native Jobs must share the runtime role and service account');
  }
  const historicalEvents = selectedHistoryEvents(world, groups, jobs);
  if (caseIndex === 4) {
    addIdleRoleSessions(jobs, historicalEvents, spec);
  }
  const approvals = relevantApproval(world, historicalEvents, jobs);
  const historyEnd = Math.max(
    ...historicalEvents.map((event) => event.event_time),
    ...approvals.publications.map((event) => event.event_time),
    ...approvals.membershipAudit.map((event) => event.event_time),
  );
  const triageTime = historyEnd + 20;
  const horizonEnd = triageTime + 20;
  const roleArn = jobs[0].role_arn;
  const iamPolicyRef = id('runtime-policy', spec.seed, spec.family, roleArn);
  const resources = [...new Set(jobs.flatMap((job) => [job.target_ref, job.operational_ref]))];
  const iamPolicy = {
    policy_snapshot_ref: iamPolicyRef,
    role_arn: roleArn,
    actions: ['s3:GetObject'],
    resources,
    valid_from: 0,
    valid_until: horizonEnd + 20,
  };
  const policySnapshots = [
    {
      snapshot_ref: iamPolicyRef,
      kind: 'runtime-read-policy',
      policy: structuredClone(iamPolicy),
      available_at: triageTime - 1,
    },
  ];
  const next = continuation(
    jobs,
    options.caseTemplate ?? CASES[caseIndex],
    spec,
    triageTime,
    horizonEnd,
    iamPolicyRef,
  );
  for (const job of jobs) {
    for (const lane of ['change', 'owner']) {
      appendTriageRevision(
        approvals,
        job,
        lane,
        next.deniedByJob.get(job.job_uid),
        spec,
        triageTime,
        horizonEnd,
      );
    }
  }
  // A delayed historical reconcile demonstrates that arrival availability,
  // rather than source timestamp alone, controls queryable evidence.
  const delayedEvent = historicalEvents.find((event) => event.kind === 'controller-reconcile');
  if (!delayedEvent) {
    throw new Error('selected native history lacks controller telemetry');
  }
  const nativeEvents = historicalEvents.map((event) => ({
    ...structuredClone(event),
    available_at:
      event.event_id === delayedEvent.event_id
        ? triageTime + 3
        : Math.min(triageTime - 1, event.event_time + 2),
  }));
  const visibleEvents = nativeEvents
    .filter((event) => event.available_at <= triageTime)
    .map((event) => {
      const projected = { ...event };
      if (CROSS_PLANE_CAUSAL_KINDS.has(projected.kind)) {
        delete projected.causal_ref;
      }
      return projected;
    });
  const grantSnapshots = approvals.grantSnapshots.map((snapshot) => ({
    ...snapshot,
    available_at: snapshot.available_at ?? triageTime - 1,
  }));
  const membershipAudit = approvals.membershipAudit.map((event) => ({
    ...event,
    available_at: Math.min(triageTime - 1, event.event_time + 2),
  }));
  const approvalPublications = approvals.publications.map((event) => ({
    ...event,
    available_at: event.available_at ?? Math.min(triageTime - 1, event.event_time + 2),
  }));
  const visible = {
    triage_time: triageTime,
    arrival_watermark: triageTime,
    horizon_end: horizonEnd,
    events: visibleEvents,
    grant_snapshots: grantSnapshots.filter((snapshot) => snapshot.available_at <= triageTime),
    approval_publications: approvalPublications.filter((event) => event.available_at <= triageTime),
    membership_audit: membershipAudit.filter((event) => event.available_at <= triageTime),
    policy_snapshots: policySnapshots,
    session_register: next.sessionRegister.sort((left, right) =>
      id('visible-session-order', spec.seed, spec.family, left.access_key_ref).localeCompare(
        id('visible-session-order', spec.seed, spec.family, right.access_key_ref),
      ),
    ),
    job_queue: next.jobQueue.sort((left, right) =>
      id('visible-job-order', spec.seed, spec.family, left.job_uid).localeCompare(
        id('visible-job-order', spec.seed, spec.family, right.job_uid),
      ),
    ),
  };
  const native = {
    triage_time: triageTime,
    triage_arrival_order: triageTime,
    history_end: historyEnd,
    horizon_end: horizonEnd,
    action_budget: 8,
    jobs: jobs.map(({ sessionEvents, source_record, ...job }) => job),
    sessions: next.sessions,
    attempts: next.attempts,
    grant_snapshots: grantSnapshots,
    approval_publications: approvalPublications,
    membership_ledger: membershipAudit,
    policy_snapshots: policySnapshots,
    iam_policy: iamPolicy,
    historical_events: nativeEvents,
    delayed_records: nativeEvents.filter((event) => event.available_at > triageTime),
  };
  return { visible, native };
}
