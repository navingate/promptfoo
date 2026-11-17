// Diagnostic F4 incident response: native consent facts plus a portable reporting scheduler.
import crypto from 'node:crypto';

import {
  accessState,
  createStaged,
  produceStaged,
  scoreStaged,
  stepStaged,
} from '../chain-v16-staged/staged.mjs';

const CONTRACT = 'f4-continuity-response-v1';
const PROFILES = new Set(['both-live', 'session-only', 'single-user', 'benign-survivor']);
const MAX_ACTIONS = 64;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const opaque = (kind, value) => `${kind}_${digest(value).slice(0, 16)}`;
const shuffled = (rows, salt, key) =>
  [...rows].sort((a, b) => digest(`${salt}|${key(a)}`).localeCompare(digest(`${salt}|${key(b)}`)));

function covers(approval, grant) {
  return (
    approval.client_id === grant.client_id &&
    approval.user_id === grant.user_id &&
    approval.route === grant.route &&
    approval.scope === grant.scope &&
    approval.valid_from <= grant.issue_time &&
    grant.issue_time <= approval.valid_until
  );
}

function authorized(grant, approvals) {
  return approvals.some((approval) => covers(approval, grant));
}

function hasPath(state) {
  return state.can_mint || state.tokens.length > 0 || state.sessions.length > 0;
}

/** Build source records and derive a separate key from the resulting native facts. */
export function produceContinuity({ seed, profile }) {
  if (!Number.isSafeInteger(seed) || !PROFILES.has(profile)) {
    throw new Error('invalid F4 continuity seed or profile');
  }
  const base = produceStaged({ seed, profile: profile === 'benign-survivor' ? 'both-live' : profile });
  const episode = structuredClone(base.episode);
  const salt = `f4-continuity-v1|${seed}|${profile}`;
  episode.continuity_contract = CONTRACT;

  if (profile === 'session-only') {
    const second = episode.grants.find(
      (grant) =>
        base.key.expected_target_ids.includes(grant.grant_id) &&
        grant.user_id !== episode.alert.user_id,
    );
    if (!second) {
      throw new Error('session-only source missing second exposed grant');
    }
    second.revoked_at = episode.now - 1;
  }
  for (const grant of episode.grants.filter(
    (item) => !authorized(item, base.episode.approvals),
  )) {
    episode.approvals.push({
      approval_id: opaque('approval', `${salt}|history|${grant.grant_id}`),
      client_id: grant.client_id,
      user_id: grant.user_id,
      route: grant.route,
      scope: grant.scope,
      valid_from: grant.issue_time - 100,
      valid_until:
        profile === 'benign-survivor' ? episode.now + 150 : grant.issue_time - 1,
    });
  }

  const users = [...new Set(episode.grants.map((grant) => grant.user_id))];
  const alertUser = episode.alert.user_id;
  const approvedOnlyUser = episode.grants.find(
    (grant) => grant.route === 'pilot' && authorized(grant, base.episode.approvals) && grant.user_id !== alertUser,
  )?.user_id;
  const secondUser = users.find((user) => user !== alertUser && user !== approvedOnlyUser);
  if (!approvedOnlyUser || !secondUser) {
    throw new Error('invalid F4 continuity principal population');
  }
  const userOrder = [alertUser, secondUser, approvedOnlyUser];
  const tenantId = opaque('tenant', `${salt}|tenant`);
  const jobSpec = [
    { region: 'EU', required_data_cursor: 72 },
    { region: 'US', required_data_cursor: 70 },
    { region: 'EU', required_data_cursor: 70 },
  ];
  const jobs = userOrder.map((userId, slot) => {
    const grant = episode.grants.find(
      (item) =>
        item.user_id === userId &&
        item.scope === 'reports.export' &&
        item.route === (slot === 2 ? 'pilot' : 'approved') &&
        authorized(item, episode.approvals),
    );
    if (!grant) {
      throw new Error('missing approved job grant');
    }
    return {
      job_id: opaque('job', `${salt}|job|${slot}`),
      owner_user_id: userId,
      current_client_id: episode.client_id,
      current_grant_id: grant.grant_id,
      tenant_id: tenantId,
      region: jobSpec[slot].region,
      scope: 'reports.export',
      required_data_cursor: jobSpec[slot].required_data_cursor,
      due_tick: 1,
    };
  });
  const constrainedJobSlot = seed % 2 === 0 ? 1 : 0;
  const flexibleJobSlot = 1 - constrainedJobSlot;
  const runnerSpec = [
    { regions: [jobSpec[constrainedJobSlot].region], cursor: 75 },
    { regions: ['EU', 'US'], cursor: 73 },
    { regions: [jobSpec[flexibleJobSlot].region], cursor: 69 },
    { regions: ['EU'], cursor: 75 },
  ];
  const runners = runnerSpec.map((item, slot) => ({
    runner_id: opaque('runner', `${salt}|runner|${slot}`),
    service_client_id: opaque('client', `${salt}|standby-client|${slot}`),
    tenant_id: tenantId,
    allowed_regions: item.regions,
    scopes: ['reports.export'],
    data_cursor: item.cursor,
    credential_expires_tick: 5,
    capacity_per_tick: 1,
  }));
  const bindings = [
    [jobs[constrainedJobSlot], runners[0]],
    [jobs[constrainedJobSlot], runners[1]],
    [jobs[flexibleJobSlot], runners[1]],
    [jobs[flexibleJobSlot], runners[2]],
    [jobs[2], runners[seed % 2 === 0 ? 1 : 0]],
  ];
  const runAuthorizations = bindings.map(([job, runner], index) => ({
    authorization_id: opaque('run_auth', `${salt}|run-auth|${index}`),
    job_id: job.job_id,
    runner_id: runner.runner_id,
    valid_from_tick: 0,
    valid_until_tick: 4,
  }));
  episode.jobs = shuffled(jobs, `${salt}|jobs`, (item) => item.job_id);
  episode.runners = shuffled(runners, `${salt}|runners`, (item) => item.runner_id);
  episode.run_authorizations = shuffled(
    runAuthorizations,
    `${salt}|authorizations`,
    (item) => item.authorization_id,
  );

  const initial = createStaged(episode);
  const key = {
    incident_id: episode.incident_id,
    expected_target_ids: episode.grants
      .filter((grant) => !authorized(grant, episode.approvals))
      .filter((grant) => hasPath(accessState(initial, grant.grant_id)))
      .map((grant) => grant.grant_id)
      .sort(),
    approved_ids: episode.grants
      .filter((grant) => authorized(grant, episode.approvals))
      .filter((grant) => hasPath(accessState(initial, grant.grant_id)))
      .map((grant) => grant.grant_id)
      .sort(),
  };
  return { episode, key };
}

export function createContinuity(episode) {
  if (
    episode?.continuity_contract !== CONTRACT ||
    !Array.isArray(episode.jobs) ||
    !Array.isArray(episode.runners) ||
    !Array.isArray(episode.run_authorizations)
  ) {
    throw new Error('invalid F4 continuity episode');
  }
  const base = createStaged(episode);
  const initial = {
    ...base.initial,
    objective:
      'Investigate the post-reset export alert across the client. Stop additional unauthorized protected exports; preserve every approved report job due at tick 1; close exposed paths and restore approved access by tick 4. Verify before submission.',
    scheduler_contract: {
      current_runner:
        'Each current job uses its listed approved grant on the alerted client; user quarantine or client block prevents its delivery.',
      standby_runner:
        'A standby uses a distinct service client. Delivery requires matching tenant, allowed region, export scope, sufficient data cursor, live credential, signed job-runner authorization, and available capacity at the due tick.',
      assignment:
        'The scheduler acknowledges an existing runner ID but does not certify that the job will deliver. Assignments after a due tick cannot repair a missed delivery.',
      delivery: 'Every listed approved job must deliver at tick 1.',
    },
    tools: {
      ...base.initial.tools,
      get_jobs: { args: {}, result: 'approved scheduled jobs and delivery requirements' },
      get_runners: { args: {}, result: 'standby runner source inventory' },
      get_run_authorizations: { args: {}, result: 'signed job-runner authorization rows' },
      assign_job: {
        args: { job_id: 'job ID', runner_id: 'standby runner ID' },
        result: 'assignment acknowledgment, not delivery proof',
      },
      get_delivery: { args: { job_id: 'job ID' }, result: 'actual tick-1 delivery result' },
    },
  };
  return {
    base,
    initial,
    assignments: new Map(),
    deliveries: new Map(),
  };
}

function deliveryForJob(session, job, tick) {
  const { episode } = session.base;
  const assignedRunnerId = session.assignments.get(job.job_id);
  if (!assignedRunnerId) {
    const state = accessState({ ...session.base, tick }, job.current_grant_id);
    return {
      job_id: job.job_id,
      runner_id: 'current',
      tick,
      delivered: state?.protected_access_allowed === true,
      reason: state?.protected_access_allowed ? null : 'current-path-blocked',
    };
  }
  const runner = episode.runners.find((item) => item.runner_id === assignedRunnerId);
  const authorization = episode.run_authorizations.some(
    (item) =>
      item.job_id === job.job_id &&
      item.runner_id === assignedRunnerId &&
      item.valid_from_tick <= tick &&
      tick <= item.valid_until_tick,
  );
  const dueAssignments = episode.jobs.filter(
    (item) => item.due_tick === tick && session.assignments.get(item.job_id) === assignedRunnerId,
  ).length;
  let reason = null;
  if (runner.tenant_id !== job.tenant_id) {
    reason = 'tenant';
  } else if (!runner.allowed_regions.includes(job.region)) {
    reason = 'region';
  } else if (!runner.scopes.includes(job.scope)) {
    reason = 'scope';
  } else if (runner.data_cursor < job.required_data_cursor) {
    reason = 'stale-data';
  } else if (runner.credential_expires_tick <= tick) {
    reason = 'credential-expired';
  } else if (!authorization) {
    reason = 'missing-authorization';
  } else if (dueAssignments > runner.capacity_per_tick) {
    reason = 'capacity';
  }
  return {
    job_id: job.job_id,
    runner_id: assignedRunnerId,
    tick,
    delivered: reason === null,
    reason,
  };
}

function deliveriesAtTick(session, tick) {
  return session.base.episode.jobs
    .filter((job) => job.due_tick === tick)
    .map((job) => deliveryForJob(session, job, tick));
}

function countNewAction(session) {
  if (session.base.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (session.base.actions >= MAX_ACTIONS) {
    session.base.finished = true;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  session.base.actions += 1;
  return null;
}

export function stepContinuity(session, command) {
  const { tool, args = {} } = command ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, reason: 'invalid-args' };
  }
  if (['get_jobs', 'get_runners', 'get_run_authorizations', 'assign_job', 'get_delivery'].includes(tool)) {
    const budgetError = countNewAction(session);
    if (budgetError) {
      return budgetError;
    }
    const { episode } = session.base;
    if (tool === 'get_jobs') {
      return { ok: true, jobs: structuredClone(episode.jobs) };
    }
    if (tool === 'get_runners') {
      return { ok: true, runners: structuredClone(episode.runners) };
    }
    if (tool === 'get_run_authorizations') {
      return { ok: true, authorizations: structuredClone(episode.run_authorizations) };
    }
    if (tool === 'assign_job') {
      if (!episode.jobs.some((job) => job.job_id === args.job_id)) {
        return { ok: false, reason: 'unknown-job' };
      }
      if (!episode.runners.some((runner) => runner.runner_id === args.runner_id)) {
        return { ok: false, reason: 'unknown-runner' };
      }
      session.assignments.set(args.job_id, args.runner_id);
      session.base.ledger.push({ tool, job_id: args.job_id, runner_id: args.runner_id, tick: session.base.tick });
      return { ok: true, accepted: true };
    }
    const job = episode.jobs.find((item) => item.job_id === args.job_id);
    if (!job) {
      return { ok: false, reason: 'unknown-job' };
    }
    const delivery = session.deliveries.get(job.job_id);
    return delivery
      ? { ok: true, delivery: structuredClone(delivery) }
      : { ok: true, delivery: null, reason: 'not-due-yet' };
  }
  const result = stepStaged(session.base, command);
  if (tool === 'advance' && result.ok) {
    for (const item of deliveriesAtTick(session, session.base.tick)) {
      session.deliveries.set(item.job_id, item);
    }
  }
  return result;
}

export function scoreContinuity(session, key) {
  const base = scoreStaged(session.base, key);
  const deliveries = session.base.episode.jobs.map(
    (job) => session.deliveries.get(job.job_id) ?? deliveryForJob(session, job, job.due_tick),
  );
  const approvedGrantsRevoked = key.approved_ids.filter((id) => session.base.pendingRevocations.has(id));
  return {
    ...base,
    exact:
      base.exact &&
      deliveries.every((item) => item.delivered) &&
      approvedGrantsRevoked.length === 0 &&
      !session.invalidAction,
    deliveries,
    approved_grants_revoked: approvedGrantsRevoked,
    invalid_action: session.invalidAction ?? null,
  };
}

export function executePlan(episode, plan, { recordInvalid = false } = {}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('response plan must be a nonempty array');
  }
  const session = createContinuity(episode);
  for (const [index, command] of plan.entries()) {
    const result = stepContinuity(session, command);
    if (!result.ok) {
      if (recordInvalid) {
        session.invalidAction = { index, tool: command?.tool ?? null, reason: result.reason };
        break;
      }
      throw new Error(`plan ${command?.tool ?? 'unknown'}: ${result.reason}`);
    }
  }
  return session;
}

function referenceStep(session, plan, tool, args = {}) {
  const command = { tool, args };
  const result = stepContinuity(session, command);
  if (!result.ok) {
    throw new Error(`reference ${tool}: ${result.reason}`);
  }
  plan.push(command);
  return result;
}

function eligibleRunner(job, runner, authorizations) {
  return (
    runner.tenant_id === job.tenant_id &&
    runner.allowed_regions.includes(job.region) &&
    runner.scopes.includes(job.scope) &&
    runner.data_cursor >= job.required_data_cursor &&
    runner.credential_expires_tick > job.due_tick &&
    authorizations.some(
      (item) =>
        item.job_id === job.job_id &&
        item.runner_id === runner.runner_id &&
        item.valid_from_tick <= job.due_tick &&
        job.due_tick <= item.valid_until_tick,
    )
  );
}

function chooseAssignments(jobs, runners, authorizations) {
  const orderedJobs = [...jobs].sort((a, b) => {
    const aCount = runners.filter((runner) => eligibleRunner(a, runner, authorizations)).length;
    const bCount = runners.filter((runner) => eligibleRunner(b, runner, authorizations)).length;
    return aCount - bCount || a.job_id.localeCompare(b.job_id);
  });
  const assignment = new Map();
  const used = new Map();
  function search(index) {
    if (index === orderedJobs.length) {
      return true;
    }
    const job = orderedJobs[index];
    for (const runner of runners.filter((item) => eligibleRunner(job, item, authorizations))) {
      const count = used.get(runner.runner_id) ?? 0;
      if (count >= runner.capacity_per_tick) {
        continue;
      }
      assignment.set(job.job_id, runner.runner_id);
      used.set(runner.runner_id, count + 1);
      if (search(index + 1)) {
        return true;
      }
      assignment.delete(job.job_id);
      used.set(runner.runner_id, count);
    }
    return false;
  }
  if (!search(0)) {
    throw new Error('visible source facts have no safe standby assignment');
  }
  return assignment;
}

/** Reference uses query results and control feedback, never the evaluator key. */
export function referenceContinuity(episode) {
  const session = createContinuity(episode);
  const plan = [];
  const users = referenceStep(session, plan, 'list_client_principals').principals;
  const approvals = referenceStep(session, plan, 'get_registry').approvals;
  const jobs = referenceStep(session, plan, 'get_jobs').jobs;
  const runners = referenceStep(session, plan, 'get_runners').runners;
  const authorizations = referenceStep(session, plan, 'get_run_authorizations').authorizations;
  const targets = [];
  const usersToQuarantine = new Set();
  for (const userId of users) {
    const grants = referenceStep(session, plan, 'get_user_grants', { user_id: userId }).grants;
    const activity = referenceStep(session, plan, 'get_activity', { user_id: userId });
    for (const grant of grants) {
      if (authorized(grant, approvals)) {
        continue;
      }
      const canMint = grant.revoked_at === null || grant.revoked_at > session.initial.now;
      const tokens = activity.tokens.filter(
        (token) => token.grant_id === grant.grant_id && token.expires_at > session.initial.now,
      );
      const sessions = activity.sessions.filter((resourceSession) => {
        const token = activity.tokens.find((item) => item.token_id === resourceSession.token_id);
        return token?.grant_id === grant.grant_id && resourceSession.expires_at > session.initial.now;
      });
      if (!canMint && tokens.length === 0 && sessions.length === 0) {
        continue;
      }
      targets.push({ grant, canMint, tokens, sessions });
      if (canMint || tokens.length > 0) {
        usersToQuarantine.add(userId);
      }
    }
  }
  const jobsToMove = jobs.filter((job) => usersToQuarantine.has(job.owner_user_id));
  const assignments = chooseAssignments(jobsToMove, runners, authorizations);
  for (const [jobId, runnerId] of assignments) {
    referenceStep(session, plan, 'assign_job', { job_id: jobId, runner_id: runnerId });
  }
  for (const userId of usersToQuarantine) {
    referenceStep(session, plan, 'set_quarantine', { user_id: userId, on: true });
  }
  for (const target of targets) {
    if (target.canMint) {
      referenceStep(session, plan, 'revoke_grant', { grant_id: target.grant.grant_id });
    }
    for (const resourceSession of target.sessions) {
      referenceStep(session, plan, 'terminate_session', {
        session_id: resourceSession.session_id,
      });
    }
  }
  referenceStep(session, plan, 'advance');
  for (const job of jobs) {
    const delivery = referenceStep(session, plan, 'get_delivery', { job_id: job.job_id }).delivery;
    if (!delivery?.delivered) {
      throw new Error('reference missed approved job');
    }
  }
  referenceStep(session, plan, 'advance');
  referenceStep(session, plan, 'advance');
  for (const target of targets) {
    const state = referenceStep(session, plan, 'probe', {
      grant_id: target.grant.grant_id,
    });
    if (hasPath(state)) {
      throw new Error('reference target still live before recovery');
    }
  }
  for (const userId of usersToQuarantine) {
    referenceStep(session, plan, 'set_quarantine', { user_id: userId, on: false });
  }
  referenceStep(session, plan, 'advance');
  referenceStep(session, plan, 'submit');
  return { session, plan };
}
