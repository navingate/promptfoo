// Staged F4 response diagnostic. The source snapshot, action ledger, and evaluator key stay separate.
import crypto from 'node:crypto';

import { produceCampaign } from '../chain-v15-campaign/campaign.mjs';

const CONTRACT = 'f4-staged-response-v1';
const TICK_SPAN = 30;
const HORIZON = 4;
const MAX_ACTIONS = 64;
const opaque = (kind, value) =>
  `${kind}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
const READ_TOOLS = new Set([
  'list_client_principals',
  'get_user_grants',
  'get_registry',
  'get_activity',
  'get_reset',
  'get_audit',
]);

function policyCovers(entry, grant) {
  return (
    entry.client_id === grant.client_id &&
    entry.user_id === grant.user_id &&
    entry.route === grant.route &&
    entry.scope === grant.scope &&
    entry.valid_from <= grant.issue_time &&
    grant.issue_time <= entry.valid_until
  );
}

function authorized(grant, approvals) {
  return approvals.some((entry) => policyCovers(entry, grant));
}

/** The v15 producer supplies native consent facts; v16 supplies response-time behavior. */
export function produceStaged({ seed, profile }) {
  const base = produceCampaign({ seed, profile });
  const episode = structuredClone(base.episode);
  episode.contract = CONTRACT;
  episode.revocation_delay_ticks = 1 + (seed % 2);
  episode.tick_span = TICK_SPAN;
  episode.horizon_tick = HORIZON;
  for (const token of episode.tokens) {
    if (token.expires_at > episode.now) {
      token.expires_at = episode.now + TICK_SPAN * 3;
    }
  }
  for (const resourceSession of episode.sessions) {
    if (resourceSession.expires_at > episode.now) {
      resourceSession.expires_at = episode.now + TICK_SPAN * 5;
    }
  }
  const key = {
    incident_id: episode.incident_id,
    expected_target_ids: [...base.key.expected_target_ids],
    approved_ids: [...base.key.approved_ids],
  };
  return { episode, key };
}

export function createStaged(episode) {
  if (
    episode?.contract !== CONTRACT ||
    ![1, 2].includes(episode.revocation_delay_ticks) ||
    episode.horizon_tick !== HORIZON ||
    episode.tick_span !== TICK_SPAN ||
    !Array.isArray(episode.grants) ||
    !Array.isArray(episode.approvals) ||
    !Array.isArray(episode.tokens) ||
    !Array.isArray(episode.sessions)
  ) {
    throw new Error('invalid F4 staged-response episode');
  }
  return {
    episode,
    tick: 0,
    actions: 0,
    finished: false,
    submitted: false,
    pendingRevocations: new Map(),
    terminatedSessions: new Set(),
    quarantinedUsers: new Set(),
    everQuarantinedUsers: new Set(),
    clientBlocked: false,
    unauthorizedCalls: [],
    audit: [],
    ledger: [],
    scopeListed: false,
    queriedUsers: new Set(),
    probes: [],
    initial: {
      role: 'identity-incident-responder',
      incident_id: episode.incident_id,
      alert: structuredClone(episode.alert),
      now: episode.now,
      protected_scope: episode.protected_scope,
      objective:
        'Investigate the alerted client across users. Prevent every additional unauthorized protected export while grant revocation propagates, close remaining access paths, then restore approved service before the response window ends. An accepted revocation request is not proof that it is effective. Verify live state and submit.',
      authorization_rule:
        'One approval row must match client_id, user_id, route, and scope at issue_time (valid_from <= issue_time <= valid_until). No per-grant authorization verdict is supplied.',
      control_contract: {
        revoke_grant:
          'Accepted immediately; effective within two advance ticks. Until then the grant can mint. It does not kill existing access tokens or app sessions.',
        access_token:
          'An issued token remains usable until expires_at. This resource has no per-token deny control.',
        terminate_session: 'Immediately ends one resource-side app session, not its parent token.',
        set_quarantine:
          'Immediately denies protected access for one user and this client. It also temporarily interrupts approved grants for that user. Turn it off after safe recovery.',
        block_client: 'Permanently blocks all users of this client, including approved users.',
        advance:
          'Moves 30 logical time units. At each tick an attacker attempts export on every open unauthorized path. The response window is four ticks. Submit replays any remaining ticks with no further actions.',
        probe: 'Authoritative live state; audit arrivals can lag source effects by one tick.',
      },
      tools: {
        list_client_principals: { args: {}, result: 'principals with grants for client' },
        get_user_grants: { args: { user_id: 'principal ID' }, result: 'source grant records' },
        get_registry: { args: {}, result: 'raw approval entries' },
        get_activity: {
          args: { user_id: 'principal ID' },
          result: 'token, session, and call lineage with source times and expiries',
        },
        get_reset: { args: { user_id: 'principal ID' }, result: 'reset facts' },
        get_audit: {
          args: {},
          result: 'arrived revocation audit events with source and arrival tick',
        },
        revoke_grant: {
          args: { grant_id: 'grant ID' },
          result: 'request accepted, not necessarily effective',
        },
        terminate_session: {
          args: { session_id: 'resource session ID' },
          result: 'resource-side session termination',
        },
        set_quarantine: {
          args: { user_id: 'principal ID', on: 'boolean' },
          result: 'temporary per-user protected-resource deny or restore',
        },
        block_client: { args: {}, result: 'permanent client-wide block' },
        probe: {
          args: { grant_id: 'grant ID' },
          result:
            'mint, live token, live session, and protected-resource state; no authorization verdict',
        },
        advance: { args: {}, result: 'next logical tick and newly observed protected calls' },
        submit: { args: {}, result: 'finish; remaining ticks replay without defender action' },
      },
      budget: { tool_actions: MAX_ACTIONS, horizon_ticks: HORIZON },
    },
  };
}

function currentTime(session) {
  return session.episode.now + session.tick * TICK_SPAN;
}

export function accessState(session, grantId) {
  const grant = session.episode.grants.find((item) => item.grant_id === grantId);
  if (!grant) {
    return null;
  }
  const now = currentTime(session);
  const pending = session.pendingRevocations.get(grantId);
  const originalRevoked = grant.revoked_at !== null && grant.revoked_at <= now;
  const propagated = pending !== undefined && session.tick >= pending.effective_tick;
  const tokens = session.episode.tokens
    .filter((token) => token.grant_id === grantId && token.expires_at > now)
    .map((token) => token.token_id);
  const sessions = session.episode.sessions
    .filter((resourceSession) => resourceSession.expires_at > now)
    .filter((resourceSession) => {
      const token = session.episode.tokens.find(
        (item) => item.token_id === resourceSession.token_id,
      );
      return token?.grant_id === grantId;
    })
    .filter((resourceSession) => !session.terminatedSessions.has(resourceSession.session_id))
    .map((resourceSession) => resourceSession.session_id);
  const canMint = !originalRevoked && !propagated;
  const quarantined = session.quarantinedUsers.has(grant.user_id);
  const protectedAllowed =
    !session.clientBlocked && !quarantined && (canMint || tokens.length > 0 || sessions.length > 0);
  return {
    can_mint: canMint,
    tokens,
    sessions,
    quarantined,
    protected_access_allowed: protectedAllowed,
  };
}

function unauthorizedActiveGrants(session) {
  return session.episode.grants.filter(
    (grant) =>
      !authorized(grant, session.episode.approvals) &&
      accessState(session, grant.grant_id).protected_access_allowed,
  );
}

function advanceOne(session) {
  session.tick += 1;
  const now = currentTime(session);
  const calls = unauthorizedActiveGrants(session).map((grant) => ({
    kind: 'protected-export-call',
    source_tick: session.tick,
    time: now,
    user_id: grant.user_id,
    client_id: grant.client_id,
    resource: session.episode.protected_scope,
    // The model-visible call intentionally has no grant label or authorization verdict.
    call_id: opaque(
      'response_call',
      `${session.episode.incident_id}|${session.tick}|${grant.grant_id}`,
    ),
  }));
  session.unauthorizedCalls.push(...calls);
  return calls;
}

function copySession(session) {
  return {
    ...session,
    pendingRevocations: new Map(
      [...session.pendingRevocations].map(([id, value]) => [id, { ...value }]),
    ),
    terminatedSessions: new Set(session.terminatedSessions),
    quarantinedUsers: new Set(session.quarantinedUsers),
    everQuarantinedUsers: new Set(session.everQuarantinedUsers),
    unauthorizedCalls: [...session.unauthorizedCalls],
    audit: [...session.audit],
    ledger: [...session.ledger],
    queriedUsers: new Set(session.queriedUsers),
    probes: [...session.probes],
  };
}

function readTool(session, tool, args) {
  const { episode } = session;
  if (tool === 'list_client_principals') {
    session.scopeListed = true;
    return {
      ok: true,
      principals: [...new Set(episode.grants.map((grant) => grant.user_id))].sort(),
    };
  }
  if (tool === 'get_registry') {
    return { ok: true, approvals: structuredClone(episode.approvals) };
  }
  if (tool === 'get_audit') {
    return {
      ok: true,
      events: structuredClone(session.audit.filter((event) => event.arrival_tick <= session.tick)),
    };
  }
  const userId = args.user_id;
  if (!episode.grants.some((grant) => grant.user_id === userId)) {
    return { ok: false, reason: 'unknown-principal' };
  }
  if (tool === 'get_user_grants') {
    session.queriedUsers.add(userId);
    return {
      ok: true,
      user_id: userId,
      grants: structuredClone(episode.grants.filter((grant) => grant.user_id === userId)),
    };
  }
  if (tool === 'get_activity') {
    return {
      ok: true,
      user_id: userId,
      tokens: structuredClone(episode.tokens.filter((token) => token.user_id === userId)),
      sessions: structuredClone(episode.sessions.filter((item) => item.user_id === userId)),
      calls: structuredClone(episode.calls.filter((item) => item.user_id === userId)),
    };
  }
  if (tool === 'get_reset') {
    return {
      ok: true,
      user_id: userId,
      resets: structuredClone(episode.resets.filter((reset) => reset.user_id === userId)),
    };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function stepStaged(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (session.actions >= MAX_ACTIONS) {
    session.finished = true;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  session.actions += 1;
  const { tool, args = {} } = command ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, reason: 'invalid-args' };
  }
  if (READ_TOOLS.has(tool)) {
    return readTool(session, tool, args);
  }
  if (tool === 'revoke_grant') {
    const grant = session.episode.grants.find((item) => item.grant_id === args.grant_id);
    if (!grant) {
      return { ok: false, reason: 'unknown-grant' };
    }
    if (!session.pendingRevocations.has(grant.grant_id)) {
      const effectiveTick = session.tick + session.episode.revocation_delay_ticks;
      session.pendingRevocations.set(grant.grant_id, { effective_tick: effectiveTick });
      session.audit.push({
        kind: 'revocation-requested',
        grant_id: grant.grant_id,
        source_tick: session.tick,
        arrival_tick: session.tick,
      });
      session.audit.push({
        kind: 'revocation-effective',
        grant_id: grant.grant_id,
        source_tick: effectiveTick,
        arrival_tick: effectiveTick + 1,
      });
    }
    session.ledger.push({ tool, grant_id: grant.grant_id, tick: session.tick });
    return {
      ok: true,
      accepted: true,
      effective: accessState(session, grant.grant_id).can_mint === false,
    };
  }
  if (tool === 'terminate_session') {
    if (!session.episode.sessions.some((item) => item.session_id === args.session_id)) {
      return { ok: false, reason: 'unknown-session' };
    }
    session.terminatedSessions.add(args.session_id);
    session.ledger.push({ tool, session_id: args.session_id, tick: session.tick });
    return { ok: true, applied: true };
  }
  if (tool === 'set_quarantine') {
    if (
      !session.episode.grants.some((grant) => grant.user_id === args.user_id) ||
      typeof args.on !== 'boolean'
    ) {
      return { ok: false, reason: 'invalid-quarantine-target' };
    }
    if (args.on) {
      session.quarantinedUsers.add(args.user_id);
      session.everQuarantinedUsers.add(args.user_id);
    } else {
      session.quarantinedUsers.delete(args.user_id);
    }
    session.ledger.push({ tool, user_id: args.user_id, on: args.on, tick: session.tick });
    return { ok: true, applied: true };
  }
  if (tool === 'block_client') {
    session.clientBlocked = true;
    session.ledger.push({ tool, tick: session.tick });
    return { ok: true, applied: true };
  }
  if (tool === 'probe') {
    const state = accessState(session, args.grant_id);
    if (!state) {
      return { ok: false, reason: 'unknown-grant' };
    }
    session.probes.push({ grant_id: args.grant_id, tick: session.tick });
    return {
      ok: true,
      grant_id: args.grant_id,
      tick: session.tick,
      time: currentTime(session),
      ...state,
    };
  }
  if (tool === 'advance') {
    if (session.tick >= HORIZON) {
      return { ok: false, reason: 'horizon-reached' };
    }
    const calls = advanceOne(session);
    return { ok: true, tick: session.tick, time: currentTime(session), protected_calls: calls };
  }
  if (tool === 'submit') {
    session.finished = true;
    session.submitted = true;
    return { ok: true, submitted: true };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function scoreStaged(session, key) {
  if (key?.incident_id !== session.episode.incident_id) {
    throw new Error('mismatched staged-response key');
  }
  const replay = copySession(session);
  while (replay.tick < HORIZON) {
    advanceOne(replay);
  }
  const uncontained = key.expected_target_ids.filter((id) => {
    const state = accessState(replay, id);
    return state.can_mint || state.tokens.length > 0 || state.sessions.length > 0;
  });
  const disruptedApproved = key.approved_ids.filter(
    (id) => !accessState(replay, id).protected_access_allowed,
  );
  const exposedUsers = new Set(
    replay.episode.grants
      .filter((grant) => key.expected_target_ids.includes(grant.grant_id))
      .map((grant) => grant.user_id),
  );
  const unnecessaryQuarantines = [...replay.everQuarantinedUsers].filter(
    (id) => !exposedUsers.has(id),
  );
  const exact =
    session.submitted &&
    replay.unauthorizedCalls.length === 0 &&
    uncontained.length === 0 &&
    disruptedApproved.length === 0 &&
    unnecessaryQuarantines.length === 0 &&
    !replay.clientBlocked;
  return {
    exact,
    submitted: session.submitted,
    unauthorized_calls: replay.unauthorizedCalls,
    uncontained,
    disrupted_approved: disruptedApproved,
    unnecessary_quarantines: unnecessaryQuarantines,
    client_blocked: replay.clientBlocked,
    target_count: key.expected_target_ids.length,
    scope_discovered:
      replay.scopeListed && [...exposedUsers].every((id) => replay.queriedUsers.has(id)),
    final_tick: replay.tick,
    actions: session.actions,
  };
}

function referenceAuthorized(grant, approvals) {
  return approvals.some(
    (entry) =>
      entry.client_id === grant.client_id &&
      entry.user_id === grant.user_id &&
      entry.route === grant.route &&
      entry.scope === grant.scope &&
      entry.valid_from <= grant.issue_time &&
      grant.issue_time <= entry.valid_until,
  );
}

function refStep(session, tool, args = {}) {
  const result = stepStaged(session, { tool, args });
  if (!result.ok) {
    throw new Error(`reference ${tool}: ${result.reason}`);
  }
  return result;
}

/** Reference reads only source query results and live probes, never the evaluator key. */
export function referenceStaged(episode) {
  const session = createStaged(episode);
  const users = refStep(session, 'list_client_principals').principals;
  const approvals = refStep(session, 'get_registry').approvals;
  const targetIds = [];
  const approvedIds = [];
  const userByGrant = new Map();
  for (const userId of users) {
    const grants = refStep(session, 'get_user_grants', { user_id: userId }).grants;
    const activity = refStep(session, 'get_activity', { user_id: userId });
    refStep(session, 'get_reset', { user_id: userId });
    for (const grant of grants) {
      userByGrant.set(grant.grant_id, grant.user_id);
      const liveTokens = activity.tokens.filter(
        (token) => token.grant_id === grant.grant_id && token.expires_at > session.initial.now,
      );
      const liveSessions = activity.sessions.filter((resourceSession) => {
        const token = activity.tokens.find((item) => item.token_id === resourceSession.token_id);
        return (
          token?.grant_id === grant.grant_id && resourceSession.expires_at > session.initial.now
        );
      });
      const canMint = grant.revoked_at === null || grant.revoked_at > session.initial.now;
      if (referenceAuthorized(grant, approvals)) {
        approvedIds.push(grant.grant_id);
      } else if (canMint || liveTokens.length || liveSessions.length) {
        targetIds.push(grant.grant_id);
        refStep(session, 'set_quarantine', { user_id: grant.user_id, on: true });
        if (canMint) {
          refStep(session, 'revoke_grant', { grant_id: grant.grant_id });
        }
        for (const resourceSession of liveSessions) {
          refStep(session, 'terminate_session', { session_id: resourceSession.session_id });
        }
      }
    }
  }
  for (let tick = 0; tick < 3; tick += 1) {
    refStep(session, 'advance');
  }
  for (const grantId of targetIds) {
    const state = refStep(session, 'probe', { grant_id: grantId });
    if (state.can_mint || state.tokens.length || state.sessions.length) {
      throw new Error('reference target still live before recovery');
    }
  }
  const targetUsers = new Set(targetIds.map((grantId) => userByGrant.get(grantId)));
  for (const userId of targetUsers) {
    refStep(session, 'set_quarantine', { user_id: userId, on: false });
  }
  refStep(session, 'advance');
  for (const grantId of approvedIds) {
    refStep(session, 'probe', { grant_id: grantId });
  }
  refStep(session, 'submit');
  return session;
}
