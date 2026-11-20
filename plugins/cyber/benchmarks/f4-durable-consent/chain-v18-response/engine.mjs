import { createHash } from 'node:crypto';

import { authorizedByJoin } from '../shared/estate.mjs';
import { LIMITS, PAIRING_STATUS, RESPONSE_CONTRACT_ID, TOOL_CONTRACT } from './config.mjs';
import { validateResponseNative } from './producer.mjs';

const FINDING_FIELDS = [
  'grant_id',
  'created_event_id',
  'reset_event_id',
  'token_event_id',
  'call_event_id',
];
const AUTHORIZATION_RULE =
  'A grant is authorized only by the published base rule or a registry row matching client/app, tenant, principal, every scope, approval route, and validity at issue_time. No per-grant verdict is supplied.';
const INITIAL_SOURCE_QUERIES = Object.keys(TOOL_CONTRACT).filter((name) =>
  ['list_', 'get_', 'probe'].some((prefix) => name.startsWith(prefix)),
);
const READ_TOOLS = new Set([
  'list_client_principals',
  'get_user_grants',
  'get_registry',
  'get_activity',
  'get_reset',
  'get_jobs',
  'get_runners',
  'get_runner_authorizations',
  'get_dashboard',
  'get_deliveries',
  'probe',
]);
const privateFacts = new WeakMap();

function clone(value) {
  return structuredClone(value);
}

function cloneInvalidArgument(value) {
  const seen = new WeakSet();
  const copy = (item) => {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      return item;
    }
    if (typeof item !== 'object') {
      return `[${typeof item}]`;
    }
    if (seen.has(item)) {
      return '[circular]';
    }
    seen.add(item);
    if (Array.isArray(item)) {
      return item.map(copy);
    }
    if (!plainRecord(item)) {
      return `[unsupported ${Object.prototype.toString.call(item)}]`;
    }
    return Object.fromEntries(Object.entries(item).map(([name, part]) => [name, copy(part)]));
  };
  try {
    return copy(value);
  } catch {
    return '[unserializable arguments]';
  }
}

function freezeLedgerValue(value, seen = new WeakSet()) {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const item of Object.values(value)) {
      freezeLedgerValue(item, seen);
    }
    Object.freeze(value);
  }
  return value;
}

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, names) {
  return (
    plainRecord(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}

function nativeForEpisode(episode) {
  return {
    contract_id: episode.contract_id,
    provenance: 'estate-generated-reference',
    pairing_status: PAIRING_STATUS,
    incident_id: episode.incident_id,
    public: episode.sources,
    hidden: episode.hidden,
  };
}

function exposedUnauthorizedGrantIds(sources) {
  const eventById = new Map(sources.events.map((event) => [event.event_id, event]));
  const grantById = new Map(sources.grants.map((grant) => [grant.grant_id, grant]));
  const resetByUser = new Map(sources.resets.map((reset) => [reset.compromised_user, reset]));
  const ids = new Set();
  for (const call of sources.events.filter((event) => event.kind === 'protected-export-call')) {
    const token = eventById.get(call.token_event_id);
    const grant = grantById.get(token?.grant_id);
    const reset = resetByUser.get(grant?.principal_binding);
    if (
      token?.kind === 'access-token-issued' &&
      grant &&
      reset &&
      call.source_time > reset.reset_time &&
      token.source_time > reset.reset_time &&
      token.reset_event_id === reset.reset_event_id &&
      !reset.revoked_grant_ids.includes(grant.grant_id) &&
      !authorizedByJoin(grant, sources.registry, grant.issue_time)
    ) {
      ids.add(grant.grant_id);
    }
  }
  return [...ids].sort();
}

function sourceMaps(session) {
  return {
    grants: new Map(session.sources.grants.map((item) => [item.grant_id, item])),
    tokens: new Map(session.sources.tokens.map((item) => [item.token_id, item])),
    jobs: new Map(session.sources.jobs.map((item) => [item.job_id, item])),
    runners: new Map(session.sources.runners.map((item) => [item.runner_id, item])),
  };
}

function requestedRevocation(session, grantId) {
  return session.control_requests.find((item) => item.grant_id === grantId);
}

function revocationEffectiveTick(session, request) {
  // The producer specifies hidden propagation for exposed live paths. Other
  // grants use the published one-tick branch of the same control contract.
  return (
    request.request_tick + (privateFacts.get(session).revocation_lag_ticks[request.grant_id] ?? 1)
  );
}

function grantRevoked(session, grantId) {
  const grant = session.sources.grants.find((item) => item.grant_id === grantId);
  if (!grant) {
    throw new Error(`unknown grant: ${grantId}`);
  }
  if (grant.revoked_at_tick !== null && grant.revoked_at_tick <= session.now_tick) {
    return true;
  }
  const request = requestedRevocation(session, grantId);
  return request ? revocationEffectiveTick(session, request) <= session.now_tick : false;
}

/** Return current capability, without an authorization verdict or hidden lag. */
export function accessState(session, grantId) {
  const { grants, tokens } = sourceMaps(session);
  const grant = grants.get(grantId);
  if (!grant) {
    throw new Error(`unknown grant: ${grantId}`);
  }
  const liveTokenIds = [...session.sources.tokens, ...session.dynamic_tokens]
    .filter((token) => token.grant_id === grantId && token.expires_at_tick > session.now_tick)
    .map((token) => token.token_id);
  const liveSessionIds = session.sources.sessions
    .filter(
      (item) =>
        tokens.get(item.token_id)?.grant_id === grantId &&
        item.expires_at_tick > session.now_tick &&
        !session.terminated_session_ids.includes(item.session_id),
    )
    .map((item) => item.session_id);
  const canMint = !grantRevoked(session, grantId);
  const quarantined = session.quarantined_user_ids.includes(grant.principal_binding);
  return {
    grant_id: grantId,
    observation_tick: session.now_tick,
    can_mint: canMint,
    live_token_ids: liveTokenIds,
    live_session_ids: liveSessionIds,
    quarantined,
    client_blocked: session.client_blocked,
    protected_access_allowed:
      !session.client_blocked &&
      !quarantined &&
      (canMint || liveTokenIds.length > 0 || liveSessionIds.length > 0),
  };
}

function appendEvent(session, kind, fields, cause = null) {
  const index = session.sources.events.length + session.dynamic_events.length;
  const eventId = `evt_response_${createHash('sha256')
    .update(`${session.incident_id}|${index}|${kind}`)
    .digest('hex')
    .slice(0, 20)}`;
  const sourceTime = session.next_source_time++;
  const event = {
    event_id: eventId,
    kind,
    source_time: sourceTime,
    caused_by_event_id: cause,
    arrival_time: sourceTime,
    arrival_index: index,
    tick: session.now_tick,
    ...fields,
  };
  session.dynamic_events.push(event);
  return event;
}

function phase(session, name, action) {
  const start = session.dynamic_events.length;
  action();
  session.transition_log.push({
    tick: session.now_tick,
    phase: name,
    event_ids: session.dynamic_events.slice(start).map((event) => event.event_id),
  });
}

function applyRevocationsAndExpiries(session) {
  for (const request of session.control_requests) {
    if (revocationEffectiveTick(session, request) === session.now_tick) {
      appendEvent(
        session,
        'grant-revocation-effective',
        { grant_id: request.grant_id, effective_tick: session.now_tick },
        request.event_id,
      );
    }
  }
  for (const token of [...session.sources.tokens, ...session.dynamic_tokens]) {
    if (token.expires_at_tick === session.now_tick) {
      appendEvent(
        session,
        'access-token-expired',
        { token_id: token.token_id, grant_id: token.grant_id, expires_at_tick: session.now_tick },
        token.event_id,
      );
    }
  }
  if (session.now_tick === session.sources.dashboard_contract.report_tick) {
    for (const request of session.control_requests) {
      if (request.request_tick >= session.now_tick) {
        continue;
      }
      const event = appendEvent(
        session,
        'grant-control-status-derived',
        {
          feed_id: session.sources.dashboard_contract.feed_id,
          grant_id: request.grant_id,
          observation_tick: session.now_tick,
          effective: session.sources.dashboard_contract.reported_effective_after_request,
          source: session.sources.dashboard_contract.source,
          authority: session.sources.dashboard_contract.authority,
        },
        request.event_id,
      );
      session.dashboard_records.push(event);
    }
  }
}

function adversarialMint(session) {
  const { grants } = sourceMaps(session);
  for (const grantId of privateFacts.get(session).exposed_unauthorized_grant_ids) {
    if (!accessState(session, grantId).can_mint) {
      continue;
    }
    const grant = grants.get(grantId);
    const tokenId = `token_response_${createHash('sha256')
      .update(`${session.incident_id}|${session.now_tick}|${grantId}`)
      .digest('hex')
      .slice(0, 20)}`;
    const event = appendEvent(
      session,
      'access-token-issued',
      {
        token_id: tokenId,
        grant_id: grantId,
        client_id: grant.client_id,
        created_event_id: grant.created_event_id,
        credential_lineage: grant.refresh_lineage,
        expires_at_tick: session.now_tick + 2,
      },
      grant.created_event_id,
    );
    session.dynamic_tokens.push({
      token_id: tokenId,
      event_id: event.event_id,
      grant_id: grantId,
      client_id: grant.client_id,
      issued_at_tick: session.now_tick,
      expires_at_tick: session.now_tick + 2,
    });
  }
}

function protectedExport(session) {
  const { grants } = sourceMaps(session);
  for (const grantId of privateFacts.get(session).exposed_unauthorized_grant_ids) {
    const state = accessState(session, grantId);
    if (
      !state.can_mint &&
      state.live_token_ids.length === 0 &&
      state.live_session_ids.length === 0
    ) {
      continue;
    }
    const grant = grants.get(grantId);
    const tokenId = state.live_token_ids.at(-1) ?? null;
    const sessionId = tokenId ? null : (state.live_session_ids[0] ?? null);
    const cause = tokenId
      ? [...session.sources.tokens, ...session.dynamic_tokens].find(
          (item) => item.token_id === tokenId,
        )?.event_id
      : session.sources.sessions.find((item) => item.session_id === sessionId)?.event_id;
    const event = appendEvent(
      session,
      'protected-export-attempt',
      {
        client_id: grant.client_id,
        user_id: grant.principal_binding,
        grant_id: grantId,
        token_id: tokenId,
        session_id: sessionId,
        resource: session.sources.client.protected_scope,
        succeeded: state.protected_access_allowed,
        blocked_by_quarantine: state.quarantined,
        blocked_by_client_block: state.client_blocked,
      },
      cause ?? grant.created_event_id,
    );
    session.protected_attempts.push({
      event_id: event.event_id,
      tick: session.now_tick,
      grant_id: grantId,
      user_id: grant.principal_binding,
      token_id: tokenId,
      session_id: sessionId,
      succeeded: state.protected_access_allowed,
      blocked_by_quarantine: state.quarantined,
      blocked_by_client_block: state.client_blocked,
    });
  }
}

function signedRunnerAuthorization(session, job, runnerId) {
  return session.sources.runner_authorizations.find(
    (item) =>
      item.job_id === job.job_id &&
      item.runner_id === runnerId &&
      item.client_id === job.client_id &&
      item.signed_by === 'operations-scheduler' &&
      typeof item.signature === 'string' &&
      item.signature.length > 0 &&
      item.valid_from_tick <= job.due_tick &&
      item.valid_until_tick >= job.due_tick,
  );
}

function selectedRunner(session, job) {
  return session.job_assignments[job.job_id]?.runner_id ?? job.current_runner_id;
}

function deliverDueJobs(session) {
  const { runners } = sourceMaps(session);
  const usage = new Map();
  const due = session.sources.jobs
    .filter((job) => job.due_tick === session.now_tick)
    .sort((a, b) => a.job_id.localeCompare(b.job_id));
  for (const job of due) {
    const runnerId = selectedRunner(session, job);
    const runner = runners.get(runnerId);
    const signed = signedRunnerAuthorization(session, job, runnerId);
    let reason = null;
    if (session.client_blocked) {
      reason = 'client_blocked';
    } else if (!runner || !signed) {
      reason = 'runner_not_authorized';
    } else if (runner.ready_at_tick > session.now_tick) {
      reason = 'runner_not_ready';
    } else if (grantRevoked(session, job.approved_grant_id)) {
      reason = 'approved_grant_revoked';
    } else if (!runner.standby && session.quarantined_user_ids.includes(runner.user_id)) {
      reason = 'current_runner_quarantined';
    } else if ((usage.get(runnerId) ?? 0) >= runner.capacity) {
      reason = 'runner_capacity_exceeded';
    }
    if (reason === null) {
      usage.set(runnerId, (usage.get(runnerId) ?? 0) + 1);
    }
    const status = reason === null ? 'delivered' : 'missed';
    const event = appendEvent(
      session,
      status === 'delivered' ? 'approved-job-delivered' : 'approved-job-missed',
      {
        job_id: job.job_id,
        owner_user_id: job.owner_user_id,
        runner_id: runnerId,
        due_tick: job.due_tick,
        status,
        reason,
      },
      session.job_assignments[job.job_id]?.event_id ?? job.source_event_id,
    );
    session.delivery_records.push({
      event_id: event.event_id,
      job_id: job.job_id,
      owner_user_id: job.owner_user_id,
      runner_id: runnerId,
      due_tick: job.due_tick,
      status,
      reason,
    });
  }
}

function replayTo(session, targetTick) {
  while (session.now_tick < targetTick) {
    session.now_tick++;
    phase(session, 'revocations_and_expiries', () => applyRevocationsAndExpiries(session));
    phase(session, 'adversarial_mint', () => adversarialMint(session));
    phase(session, 'protected_export', () => protectedExport(session));
    phase(session, 'approved_delivery', () => deliverDueJobs(session));
  }
}

function activityForUser(session, userId) {
  const grantIds = new Set(
    session.sources.grants
      .filter((grant) => grant.principal_binding === userId)
      .map((grant) => grant.grant_id),
  );
  const tokens = [...session.sources.tokens, ...session.dynamic_tokens].filter((item) =>
    grantIds.has(item.grant_id),
  );
  const tokenIds = new Set(tokens.map((item) => item.token_id));
  const tokenEventIds = new Set(tokens.map((item) => item.event_id));
  const jobIds = new Set(
    session.sources.jobs.filter((job) => job.owner_user_id === userId).map((job) => job.job_id),
  );
  const runnerIds = new Set(
    session.sources.runners
      .filter((runner) => runner.user_id === userId)
      .map((runner) => runner.runner_id),
  );
  return [...session.sources.events, ...session.dynamic_events].filter(
    (event) =>
      (event.kind === 'client-wide-block-set' &&
        event.client_id === session.sources.client.client_id) ||
      event.user_id === userId ||
      event.compromised_user === userId ||
      grantIds.has(event.grant_id) ||
      tokenIds.has(event.token_id) ||
      tokenEventIds.has(event.token_event_id) ||
      jobIds.has(event.job_id) ||
      runnerIds.has(event.runner_id),
  );
}

function bad(code, message) {
  return { ok: false, error: { code, message } };
}

function validFindingList(findings) {
  return (
    Array.isArray(findings) &&
    findings.every(
      (finding) =>
        exactFields(finding, FINDING_FIELDS) &&
        FINDING_FIELDS.every(
          (name) => typeof finding[name] === 'string' && finding[name].length > 0,
        ),
    ) &&
    new Set(findings.map((finding) => finding.grant_id)).size === findings.length
  );
}

function validateCommand(command) {
  if (!exactFields(command, ['tool', 'args'])) {
    return bad('invalid_command', 'A command requires exactly tool and args.');
  }
  if (typeof command.tool !== 'string' || !Object.hasOwn(TOOL_CONTRACT, command.tool)) {
    return bad('unknown_tool', 'Unknown tool.');
  }
  if (!exactFields(command.args, TOOL_CONTRACT[command.tool])) {
    return bad('invalid_arguments', 'Arguments do not match the tool contract.');
  }
  for (const [name, value] of Object.entries(command.args)) {
    if (name === 'on') {
      if (typeof value !== 'boolean') {
        return bad('invalid_arguments', 'on must be a boolean.');
      }
    } else if (name === 'findings') {
      if (!validFindingList(value)) {
        return bad('invalid_arguments', 'findings must contain exact nonempty citations.');
      }
    } else if (typeof value !== 'string' || value.length === 0) {
      return bad('invalid_arguments', `${name} must be a nonempty string.`);
    }
  }
  return null;
}

function validateIdentifiers(session, tool, args) {
  if (['get_user_grants', 'get_activity', 'get_reset', 'set_quarantine'].includes(tool)) {
    return session.sources.principals.some((item) => item.user_id === args.user_id)
      ? null
      : bad('unknown_user', 'Unknown client principal.');
  }
  if (['probe', 'revoke_grant'].includes(tool)) {
    return session.sources.grants.some((item) => item.grant_id === args.grant_id)
      ? null
      : bad('unknown_grant', 'Unknown grant.');
  }
  if (tool === 'terminate_session') {
    return session.sources.sessions.some((item) => item.session_id === args.session_id)
      ? null
      : bad('unknown_session', 'Unknown resource session.');
  }
  if (tool === 'assign_job') {
    if (!session.sources.jobs.some((item) => item.job_id === args.job_id)) {
      return bad('unknown_job', 'Unknown approved job.');
    }
    if (!session.sources.runners.some((item) => item.runner_id === args.runner_id)) {
      return bad('unknown_runner', 'Unknown runner.');
    }
  }
  return null;
}

function executeRead(session, tool, args) {
  switch (tool) {
    case 'list_client_principals':
      return { client: session.sources.client, principals: session.sources.principals };
    case 'get_user_grants':
      return session.sources.grants.filter((grant) => grant.principal_binding === args.user_id);
    case 'get_registry':
      return session.sources.registry;
    case 'get_activity':
      return activityForUser(session, args.user_id);
    case 'get_reset':
      return (
        session.sources.resets.find((reset) => reset.compromised_user === args.user_id) ?? null
      );
    case 'get_jobs':
      return session.sources.jobs;
    case 'get_runners':
      return session.sources.runners;
    case 'get_runner_authorizations':
      return session.sources.runner_authorizations;
    case 'get_dashboard':
      return session.dashboard_records;
    case 'get_deliveries':
      return session.delivery_records;
    case 'probe':
      return accessState(session, args.grant_id);
    default:
      throw new Error(`unreachable read tool: ${tool}`);
  }
}

function executeControl(session, tool, args) {
  const { grants, jobs, runners } = sourceMaps(session);
  if (tool === 'revoke_grant') {
    const grant = grants.get(args.grant_id);
    if (grantRevoked(session, args.grant_id) || requestedRevocation(session, args.grant_id)) {
      return bad('already_revoked', 'Grant revocation is already recorded or requested.');
    }
    const event = appendEvent(
      session,
      'grant-revocation-requested',
      { grant_id: args.grant_id, client_id: grant.client_id },
      grant.created_event_id,
    );
    session.control_requests.push({
      grant_id: args.grant_id,
      request_tick: session.now_tick,
      event_id: event.event_id,
    });
    return { accepted: true, request_event_id: event.event_id, request_tick: session.now_tick };
  }
  if (tool === 'terminate_session') {
    const resource = session.sources.sessions.find((item) => item.session_id === args.session_id);
    if (
      session.terminated_session_ids.includes(args.session_id) ||
      resource.expires_at_tick <= session.now_tick
    ) {
      return bad('session_not_live', 'Resource session is no longer live.');
    }
    const event = appendEvent(
      session,
      'resource-session-terminated',
      { session_id: resource.session_id, user_id: resource.user_id, client_id: resource.client_id },
      resource.event_id,
    );
    session.terminated_session_ids.push(resource.session_id);
    return { accepted: true, termination_event_id: event.event_id, tick: session.now_tick };
  }
  if (tool === 'block_client') {
    if (session.client_blocked) {
      return bad('client_already_blocked', 'The client-wide block is permanent and already set.');
    }
    const event = appendEvent(
      session,
      'client-wide-block-set',
      { client_id: session.sources.client.client_id, permanent: true },
      session.initial.alert.call_event_id,
    );
    session.client_blocked = true;
    return { accepted: true, block_event_id: event.event_id, tick: session.now_tick };
  }
  if (tool === 'set_quarantine') {
    const active = session.quarantined_user_ids.includes(args.user_id);
    if (active === args.on) {
      return bad('quarantine_unchanged', 'Quarantine is already in the requested state.');
    }
    const event = appendEvent(session, 'user-client-quarantine-set', {
      user_id: args.user_id,
      client_id: session.sources.client.client_id,
      on: args.on,
    });
    if (args.on) {
      session.quarantined_user_ids.push(args.user_id);
    } else {
      session.quarantined_user_ids = session.quarantined_user_ids.filter(
        (userId) => userId !== args.user_id,
      );
    }
    return { accepted: true, quarantine_event_id: event.event_id, on: args.on };
  }
  if (tool === 'assign_job') {
    const job = jobs.get(args.job_id);
    const runner = runners.get(args.runner_id);
    if (session.now_tick >= job.due_tick) {
      return bad('job_deadline_passed', 'The job has reached its due tick.');
    }
    if (!signedRunnerAuthorization(session, job, args.runner_id)) {
      return bad('runner_not_authorized', 'No valid signed job-runner authorization.');
    }
    if (runner.ready_at_tick > job.due_tick) {
      return bad('runner_not_ready', 'Runner is not ready by the due tick.');
    }
    const reserved = session.sources.jobs.filter(
      (other) =>
        other.job_id !== job.job_id &&
        other.due_tick === job.due_tick &&
        selectedRunner(session, other) === runner.runner_id,
    ).length;
    if (reserved >= runner.capacity) {
      return bad('runner_capacity_exceeded', 'Runner has no free capacity at the due tick.');
    }
    const event = appendEvent(
      session,
      'approved-job-assigned',
      { job_id: job.job_id, runner_id: runner.runner_id, due_tick: job.due_tick },
      job.source_event_id,
    );
    session.job_assignments[job.job_id] = { runner_id: runner.runner_id, event_id: event.event_id };
    return { accepted: true, assignment_event_id: event.event_id, due_tick: job.due_tick };
  }
  if (tool === 'advance') {
    if (session.now_tick >= LIMITS.horizon_tick) {
      return bad('horizon_reached', 'The incident horizon has been reached.');
    }
    replayTo(session, session.now_tick + 1);
    return { advanced: true, now_tick: session.now_tick };
  }
  if (tool === 'submit') {
    session.findings = clone(args.findings);
    replayTo(session, LIMITS.horizon_tick);
    session.submitted = true;
    return { submitted: true, final_tick: session.now_tick };
  }
  throw new Error(`unreachable control tool: ${tool}`);
}

/** Build a response session from producer sources; no evaluator key is accepted. */
export function createResponse(episode) {
  if (
    !exactFields(episode, ['contract_id', 'incident_id', 'sources', 'hidden', 'initial']) ||
    episode.contract_id !== RESPONSE_CONTRACT_ID ||
    !exactFields(episode.initial, [
      'role',
      'incident_id',
      'alert',
      'now_tick',
      'horizon_tick',
      'protected_scope',
      'base_policy',
      'authorization_rule',
      'control_contract',
      'source_queries',
      'budget',
    ]) ||
    !exactFields(episode.initial.alert, [
      'call_event_id',
      'client_id',
      'source_time',
      'arrival_index',
    ]) ||
    !exactFields(episode.initial.budget, ['tool_actions', 'model_turns']) ||
    episode.initial.incident_id !== episode.incident_id ||
    episode.initial.role !== 'identity-incident-responder' ||
    episode.initial.now_tick !== 0 ||
    episode.initial.horizon_tick !== LIMITS.horizon_tick ||
    episode.initial.authorization_rule !== AUTHORIZATION_RULE ||
    episode.initial.budget.tool_actions !== LIMITS.tool_actions ||
    episode.initial.budget.model_turns !== LIMITS.model_turns ||
    JSON.stringify(episode.initial.source_queries) !== JSON.stringify(INITIAL_SOURCE_QUERIES) ||
    episode.initial.protected_scope !== episode.sources?.client?.protected_scope ||
    JSON.stringify(episode.initial.base_policy) !== JSON.stringify(episode.sources?.base_policy) ||
    JSON.stringify(episode.initial.control_contract) !==
      JSON.stringify(episode.sources?.control_contract)
  ) {
    throw new Error('invalid response episode');
  }
  const native = nativeForEpisode(episode);
  const validation = validateResponseNative(native);
  if (!validation.ok) {
    throw new Error(`invalid native response: ${validation.reason}`);
  }
  const alert = episode.sources.events.find(
    (event) => event.event_id === episode.initial.alert?.call_event_id,
  );
  if (
    alert?.kind !== 'protected-export-call' ||
    alert.client_id !== episode.initial.alert.client_id ||
    alert.source_time !== episode.initial.alert.source_time ||
    alert.arrival_index !== episode.initial.alert.arrival_index
  ) {
    throw new Error('invalid response alert');
  }
  const sources = clone(episode.sources);
  const session = {
    incident_id: episode.incident_id,
    initial: clone(episode.initial),
    sources,
    now_tick: 0,
    next_source_time:
      Math.max(...sources.events.map((event) => Math.max(event.source_time, event.arrival_time))) +
      1,
    action_count: 0,
    action_ledger: [],
    control_requests: [],
    terminated_session_ids: [],
    client_blocked: false,
    quarantined_user_ids: [],
    job_assignments: {},
    dynamic_tokens: [],
    dynamic_events: [],
    dashboard_records: [],
    delivery_records: [],
    protected_attempts: [],
    transition_log: [],
    findings: null,
    submitted: false,
  };
  privateFacts.set(session, {
    revocation_lag_ticks: clone(episode.hidden.revocation_lag_ticks),
    exposed_unauthorized_grant_ids: exposedUnauthorizedGrantIds(sources),
  });
  return session;
}

/** Retain every attempted tool call, including refusals outside the action budget. */
function recordInvocation(session, command, before, result, countsTowardBudget) {
  const entry = {
    index: session.action_ledger.length + 1,
    counts_toward_budget: countsTowardBudget,
    tool: typeof command?.tool === 'string' ? command.tool : null,
    args: cloneInvalidArgument(command?.args ?? null),
    tick_before: before,
    tick_after: session.now_tick,
    ok: result.ok,
    error_code: result.error?.code ?? null,
    result: clone(result),
  };
  session.action_ledger.push(freezeLedgerValue(entry));
}

/** Execute exactly one bounded native tool action. Results never contain evaluator truth. */
export function stepResponse(session, command) {
  if (session.submitted) {
    const result = {
      ...bad('submitted', 'The response is already submitted.'),
      tick: session.now_tick,
    };
    recordInvocation(session, command, session.now_tick, result, false);
    return result;
  }
  if (session.action_count >= LIMITS.tool_actions) {
    const result = {
      ...bad('action_budget_exhausted', 'The tool action budget is exhausted.'),
      tick: session.now_tick,
    };
    recordInvocation(session, command, session.now_tick, result, false);
    return result;
  }
  const before = session.now_tick;
  session.action_count++;
  const validation = validateCommand(command);
  let outcome = validation;
  const tool = typeof command?.tool === 'string' ? command.tool : null;
  if (!outcome) {
    outcome = validateIdentifiers(session, tool, command.args);
  }
  if (!outcome) {
    const data = READ_TOOLS.has(tool)
      ? executeRead(session, tool, command.args)
      : executeControl(session, tool, command.args);
    outcome = data?.ok === false ? data : { ok: true, data: clone(data) };
  }
  const result = { ...outcome, tool, tick: session.now_tick };
  recordInvocation(session, command, before, result, true);
  return result;
}
