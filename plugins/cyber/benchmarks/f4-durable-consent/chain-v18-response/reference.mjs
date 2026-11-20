import { createResponse, stepResponse } from './engine.mjs';

function selectorMatches(selector, value) {
  if (selector === undefined || selector === null) {
    return false;
  }
  if (selector === '*') {
    return true;
  }
  if (Array.isArray(selector)) {
    return Array.isArray(value)
      ? value.every((item) => selector.includes(item))
      : selector.includes(value);
  }
  return Array.isArray(value) ? value.every((item) => item === selector) : value === selector;
}

function authorized(grant, registry, basePolicy) {
  if (
    basePolicy.rules.some(
      (rule) =>
        grant.grantor_type === rule.grantor_type &&
        grant.approval_route === rule.approval_route &&
        grant.verification_state === rule.verification_state &&
        (!rule.scopes_within_catalog ||
          grant.scopes.every((scope) => grant.catalog_scopes.includes(scope))),
    )
  ) {
    return true;
  }
  return registry.some(
    (row) =>
      selectorMatches(row.client_or_app_selector, grant.client_id) &&
      selectorMatches(row.tenant_selector, grant.tenant) &&
      selectorMatches(row.principal_selector, grant.principal_binding) &&
      selectorMatches(row.scope_selector, grant.scopes) &&
      selectorMatches(row.approval_route_selector, grant.approval_route) &&
      (row.valid_from === null ||
        row.valid_from === undefined ||
        row.valid_from <= grant.issue_time) &&
      (row.valid_until === null ||
        row.valid_until === undefined ||
        row.valid_until >= grant.issue_time) &&
      (row.revoked_at === null ||
        row.revoked_at === undefined ||
        row.revoked_at > grant.issue_time),
  );
}

function observedFindings(facts, initial) {
  const eventById = new Map(facts.events.map((event) => [event.event_id, event]));
  const grantById = new Map(facts.grants.map((grant) => [grant.grant_id, grant]));
  const resetByUser = new Map(
    [...facts.resets.values()].filter(Boolean).map((reset) => [reset.compromised_user, reset]),
  );
  const findings = [];
  for (const call of facts.events.filter(
    (event) => event.kind === 'protected-export-call' && event.resource === initial.protected_scope,
  )) {
    const token = eventById.get(call.token_event_id);
    const grant = grantById.get(token?.grant_id);
    const created = eventById.get(grant?.created_event_id);
    const reset = resetByUser.get(grant?.principal_binding);
    const resetEvent = eventById.get(reset?.reset_event_id);
    if (
      token?.kind !== 'access-token-issued' ||
      created?.kind !== 'delegated-grant-created' ||
      resetEvent?.kind !== 'compromised-user-remediated' ||
      token.created_event_id !== created.event_id ||
      token.caused_by_event_id !== created.event_id ||
      token.credential_lineage !== grant.refresh_lineage ||
      token.client_id !== grant.client_id ||
      created.grant_id !== grant.grant_id ||
      created.client_id !== grant.client_id ||
      created.principal_binding !== grant.principal_binding ||
      created.credential_lineage !== grant.refresh_lineage ||
      resetEvent.compromised_user !== grant.principal_binding ||
      token.reset_event_id !== reset.reset_event_id ||
      call.caused_by_event_id !== token.event_id ||
      call.client_id !== grant.client_id ||
      grant.issue_time >= reset.reset_time ||
      token.source_time <= reset.reset_time ||
      call.source_time <= token.source_time ||
      reset.revoked_grant_ids.includes(grant.grant_id) ||
      authorized(grant, facts.registry, initial.base_policy)
    ) {
      continue;
    }
    findings.push({
      grant_id: grant.grant_id,
      created_event_id: created.event_id,
      reset_event_id: reset.reset_event_id,
      token_event_id: token.event_id,
      call_event_id: call.event_id,
    });
  }
  return [...new Map(findings.map((item) => [item.grant_id, item])).values()];
}

function signedStandbys(job, runners, authorizations) {
  return runners.filter(
    (runner) =>
      runner.standby &&
      runner.ready_at_tick <= job.due_tick &&
      runner.capacity > 0 &&
      authorizations.some(
        (row) =>
          row.job_id === job.job_id &&
          row.runner_id === runner.runner_id &&
          row.client_id === job.client_id &&
          row.signed_by === 'operations-scheduler' &&
          typeof row.signature === 'string' &&
          row.signature.length > 0 &&
          row.valid_from_tick <= job.due_tick &&
          row.valid_until_tick >= job.due_tick,
      ),
  );
}

function inspect(initial, call) {
  const { client, principals } = call('list_client_principals');
  const registry = call('get_registry');
  const grants = [];
  const events = [];
  const resets = new Map();
  for (const principal of principals) {
    grants.push(...call('get_user_grants', { user_id: principal.user_id }));
    events.push(...call('get_activity', { user_id: principal.user_id }));
    resets.set(principal.user_id, call('get_reset', { user_id: principal.user_id }));
  }
  const jobs = call('get_jobs');
  const runners = call('get_runners');
  const authorizations = call('get_runner_authorizations');
  const uniqueEvents = [...new Map(events.map((event) => [event.event_id, event])).values()];
  if (client.client_id !== initial.alert.client_id) {
    throw new Error('alert client disagrees with principal source');
  }
  const alert = uniqueEvents.find((event) => event.event_id === initial.alert.call_event_id);
  if (
    alert?.kind !== 'protected-export-call' ||
    alert.client_id !== client.client_id ||
    alert.source_time !== initial.alert.source_time ||
    alert.arrival_index !== initial.alert.arrival_index
  ) {
    throw new Error('alert call disagrees with causal activity');
  }
  return {
    client,
    principals,
    registry,
    grants,
    events: uniqueEvents,
    resets,
    jobs,
    runners,
    authorizations,
  };
}

function livePathsForGrant(grantId, facts) {
  const tokenEvents = facts.events.filter(
    (event) => event.kind === 'access-token-issued' && event.grant_id === grantId,
  );
  const tokenIds = new Set(tokenEvents.map((event) => event.token_id));
  const sessions = facts.events.filter(
    (event) => event.kind === 'resource-session-created' && tokenIds.has(event.token_id),
  );
  return { tokenEvents, sessions };
}

function checkAggregate(userId, grants, data) {
  const owned = grants.filter((grant) => grant.principal_binding === userId);
  const expected = new Set(owned.map((grant) => grant.grant_id));
  if (
    data.user_id !== userId ||
    data.grants.length !== expected.size ||
    data.grants.some(
      (row) => !expected.delete(row.grant_id) || row.observation_tick !== data.observation_tick,
    ) ||
    expected.size > 0
  ) {
    throw new Error('aggregate live probe disagrees with visible grant ownership');
  }
  return data.grants;
}

function safeToRelease(userId, facts, rows, initial) {
  const byGrant = new Map(rows.map((row) => [row.grant_id, row]));
  return facts.grants
    .filter(
      (grant) =>
        grant.principal_binding === userId &&
        !authorized(grant, facts.registry, initial.base_policy),
    )
    .every((grant) => {
      const state = byGrant.get(grant.grant_id);
      return (
        state && !state.can_mint && !state.live_token_ids.length && !state.live_session_ids.length
      );
    });
}

function verifyRestored(userId, facts, rows, initial) {
  const byGrant = new Map(rows.map((row) => [row.grant_id, row]));
  for (const grant of facts.grants.filter((item) => item.principal_binding === userId)) {
    const state = byGrant.get(grant.grant_id);
    const approved = authorized(grant, facts.registry, initial.base_policy);
    if (
      !state ||
      (approved && !state.protected_access_allowed) ||
      (!approved &&
        (state.can_mint ||
          state.live_token_ids.length > 0 ||
          state.live_session_ids.length > 0 ||
          state.protected_access_allowed))
    ) {
      throw new Error(
        'release probe did not verify denied unauthorized and usable approved grants',
      );
    }
  }
}

function assignQuarantinedJobs(tick, facts, quarantined, call) {
  const jobs = facts.jobs.filter(
    (item) => item.due_tick === tick && quarantined.has(item.owner_user_id),
  );
  const choices = new Map(
    jobs.map((job) => [job.job_id, signedStandbys(job, facts.runners, facts.authorizations)]),
  );
  const constrainedFirst = [...jobs].sort(
    (a, b) => choices.get(a.job_id).length - choices.get(b.job_id).length,
  );
  const reserved = new Map();
  const assignment = new Map();
  const search = (index) => {
    if (index === constrainedFirst.length) {
      return true;
    }
    const job = constrainedFirst[index];
    for (const runner of choices.get(job.job_id)) {
      const used = reserved.get(runner.runner_id) ?? 0;
      if (used >= runner.capacity) {
        continue;
      }
      assignment.set(job.job_id, runner.runner_id);
      reserved.set(runner.runner_id, used + 1);
      if (search(index + 1)) {
        return true;
      }
      assignment.delete(job.job_id);
      reserved.set(runner.runner_id, used);
    }
    return false;
  };
  if (!search(0)) {
    throw new Error('no feasible signed standby assignment for quarantined approved jobs');
  }
  for (const job of jobs) {
    call('assign_job', { job_id: job.job_id, runner_id: assignment.get(job.job_id) });
  }
}

function readDueDeliveries(tick, facts, call) {
  const records = call('get_deliveries');
  for (const job of facts.jobs.filter((item) => item.due_tick <= tick)) {
    if (!records.some((record) => record.job_id === job.job_id && record.status === 'delivered')) {
      throw new Error(`approved job was not delivered by tick ${tick}`);
    }
  }
}

function respondVisible(initial, call) {
  const facts = inspect(initial, call);
  const findings = observedFindings(facts, initial);
  const grants = new Map(facts.grants.map((grant) => [grant.grant_id, grant]));
  const quarantined = new Set();
  const affectedUsers = new Set();
  for (const finding of findings) {
    const grant = grants.get(finding.grant_id);
    const userId = grant.principal_binding;
    affectedUsers.add(userId);
    const { tokenEvents, sessions } = livePathsForGrant(grant.grant_id, facts);
    const needsQuarantine =
      grant.revoked_at_tick === null || tokenEvents.some((event) => event.expires_at_tick > 1);
    if (needsQuarantine && !quarantined.has(userId)) {
      call('set_quarantine', { user_id: userId, on: true });
      quarantined.add(userId);
    }
    if (grant.revoked_at_tick === null) {
      call('revoke_grant', { grant_id: grant.grant_id });
    }
    for (const resource of sessions.filter((event) => event.expires_at_tick > 0)) {
      call('terminate_session', { session_id: resource.session_id });
    }
  }
  assignQuarantinedJobs(1, facts, quarantined, call);

  const probe = (userId) =>
    checkAggregate(userId, facts.grants, call('probe_user', { user_id: userId }));
  const releaseIfSafe = (userId, rows) => {
    if (!safeToRelease(userId, facts, rows, initial)) {
      return;
    }
    call('set_quarantine', { user_id: userId, on: false });
    quarantined.delete(userId);
    verifyRestored(userId, facts, probe(userId), initial);
  };

  call('advance');
  readDueDeliveries(1, facts, call);
  if (quarantined.size > 1) {
    call('get_dashboard');
  }
  for (const userId of [...quarantined]) {
    releaseIfSafe(userId, probe(userId));
  }
  assignQuarantinedJobs(2, facts, quarantined, call);

  call('advance');
  readDueDeliveries(2, facts, call);
  for (const userId of [...quarantined]) {
    releaseIfSafe(userId, probe(userId));
  }

  call('advance');
  for (const userId of [...quarantined]) {
    releaseIfSafe(userId, probe(userId));
  }
  if (quarantined.size > 0) {
    throw new Error('remaining users could not be safely released by tick three');
  }

  call('advance');
  for (const userId of affectedUsers) {
    probe(userId);
  }
  readDueDeliveries(4, facts, call);
  call('submit', { findings });
}

/** One native invocation is one turn. The decision function sees only initial and tool results. */
export function runReference(episode, { create = createResponse, step = stepResponse } = {}) {
  const session = create(episode);
  const transcript = [];
  const call = (tool, args = {}) => {
    const command = { tool, args };
    const result = step(session, command);
    transcript.push({ index: transcript.length + 1, command, result });
    if (!result.ok) {
      throw new Error(`reference ${tool} failed: ${JSON.stringify(result.error)}`);
    }
    return result.data;
  };
  respondVisible(session.initial, call);
  return { session, transcript, turns: transcript.length, actions: transcript.length };
}
