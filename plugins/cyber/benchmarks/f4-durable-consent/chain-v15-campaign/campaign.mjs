// F4 campaign-response diagnostic. Native source facts and response ledger are separate.
import crypto from 'node:crypto';

const PROFILES = new Set(['both-live', 'session-only', 'single-user']);
const MAX_ACTIONS = 64;
const CONTRACT = 'f4-consent-campaign-v1';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const opaque = (kind, salt) => `${kind}_${sha(salt).slice(0, 16)}`;
const shuffled = (items, salt, id) =>
  [...items].sort((a, b) => sha(`${salt}|${id(a)}`).localeCompare(sha(`${salt}|${id(b)}`)));

function covers(entry, grant) {
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
  return approvals.some((entry) => covers(entry, grant));
}

function buildFacts(seed, profile) {
  if (!Number.isSafeInteger(seed) || !PROFILES.has(profile)) {
    throw new Error('invalid F4 campaign seed or profile');
  }
  const salt = `f4-campaign-v1|${seed}|${profile}`;
  const now = 200 + (seed % 23) * 10;
  const resetTime = now - 70;
  const clientId = opaque('client', `${salt}|shared-client`);
  const users = [0, 1, 2].map((i) => opaque('user', `${salt}|user|${i}`));
  const spec = [
    { slot: 0, user: 0, route: 'pilot', issue: now - 160, revoke: null },
    { slot: 1, user: 0, route: 'approved', issue: now - 150, revoke: null },
    {
      slot: 2,
      user: 1,
      route: 'pilot',
      issue: now - 140,
      revoke: profile === 'single-user' ? now - 20 : null,
    },
    { slot: 3, user: 1, route: 'approved', issue: now - 130, revoke: null },
    { slot: 4, user: 2, route: 'pilot', issue: now - 120, revoke: null },
    { slot: 5, user: 0, route: 'legacy', issue: now - 170, revoke: resetTime },
  ];
  const grants = spec.map((item) => ({
    grant_id: opaque('grant', `${salt}|grant|${item.slot}`),
    client_id: clientId,
    user_id: users[item.user],
    route: item.route,
    scope: 'reports.export',
    issue_time: item.issue,
    revoked_at: item.revoke,
  }));
  const approvals = [
    { slot: 0, grant: grants[1], route: 'approved', scope: 'reports.export' },
    { slot: 1, grant: grants[3], route: 'approved', scope: 'reports.export' },
    { slot: 2, grant: grants[4], route: 'pilot', scope: 'reports.export' },
    { slot: 3, grant: grants[0], route: 'pilot', scope: 'reports.read' },
    { slot: 4, grant: grants[2], route: 'approved', scope: 'reports.export' },
  ].map((item) => ({
    approval_id: opaque('approval', `${salt}|approval|${item.slot}`),
    client_id: clientId,
    user_id: item.grant.user_id,
    route: item.route,
    scope: item.scope,
    valid_from: now - 200,
    valid_until: now + 100,
  }));
  const tokens = grants.map((grant, slot) => {
    const expired = slot === 5 || (slot === 2 && ['session-only', 'single-user'].includes(profile));
    return {
      token_id: opaque('token', `${salt}|token|${slot}`),
      grant_id: grant.grant_id,
      client_id: clientId,
      user_id: grant.user_id,
      issued_at: slot === 5 ? resetTime - 20 : now - 40 + slot,
      expires_at: expired ? now - 1 : now + 80 + slot,
    };
  });
  const sessions = grants.map((grant, slot) => ({
    session_id: opaque('resource_session', `${salt}|resource-session|${slot}`),
    token_id: tokens[slot].token_id,
    client_id: clientId,
    user_id: grant.user_id,
    created_at: slot === 5 ? resetTime - 10 : now - 30 + slot,
    expires_at:
      slot === 5 || (slot === 2 && profile === 'single-user') ? now - 1 : now + 110 + slot,
  }));
  const calls = sessions.map((session, slot) => ({
    call_id: opaque('call', `${salt}|call|${slot}`),
    session_id: session.session_id,
    client_id: clientId,
    user_id: session.user_id,
    resource: 'reports.export',
    time: slot === 5 ? resetTime - 5 : now - 10 + slot,
  }));
  const resets = [
    {
      reset_id: opaque('reset', `${salt}|reset|0`),
      user_id: users[0],
      time: resetTime,
      revoked_grant_ids: [grants[5].grant_id],
      password_reset: true,
      sessions_revoked: true,
    },
  ];
  const alert = {
    alert_id: opaque('alert', `${salt}|alert`),
    user_id: users[0],
    client_id: clientId,
    protected_call_id: calls[0].call_id,
    time: calls[0].time,
    summary: 'Protected export call after compromised-user reset',
  };
  return {
    contract: CONTRACT,
    incident_id: opaque('incident', salt),
    now,
    client_id: clientId,
    protected_scope: 'reports.export',
    alert,
    grants: shuffled(grants, `${salt}|grants`, (item) => item.grant_id),
    approvals: shuffled(approvals, `${salt}|approvals`, (item) => item.approval_id),
    tokens: shuffled(tokens, `${salt}|tokens`, (item) => item.token_id),
    sessions: shuffled(sessions, `${salt}|sessions`, (item) => item.session_id),
    calls: shuffled(calls, `${salt}|calls`, (item) => item.call_id),
    resets,
  };
}

function initialAccess(episode, grant) {
  return {
    can_mint: grant.revoked_at === null || grant.revoked_at > episode.now,
    tokens: episode.tokens
      .filter((token) => token.grant_id === grant.grant_id && token.expires_at > episode.now)
      .map((token) => token.token_id),
    sessions: episode.sessions
      .filter((session) => {
        const token = episode.tokens.find((item) => item.token_id === session.token_id);
        return token?.grant_id === grant.grant_id && session.expires_at > episode.now;
      })
      .map((session) => session.session_id),
  };
}

function hasAccess(state) {
  return state.can_mint || state.tokens.length > 0 || state.sessions.length > 0;
}

/** The evaluator key is derived from native facts and never staged in the model session. */
export function produceCampaign({ seed, profile }) {
  const native = buildFacts(seed, profile);
  const episode = structuredClone(native);
  const expectedTargetIds = native.grants
    .filter(
      (grant) => !authorized(grant, native.approvals) && hasAccess(initialAccess(native, grant)),
    )
    .map((grant) => grant.grant_id)
    .sort();
  const approvedIds = native.grants
    .filter(
      (grant) => authorized(grant, native.approvals) && hasAccess(initialAccess(native, grant)),
    )
    .map((grant) => grant.grant_id)
    .sort();
  const key = {
    incident_id: native.incident_id,
    expected_target_ids: expectedTargetIds,
    approved_ids: approvedIds,
  };
  if (
    expectedTargetIds.length !== (profile === 'single-user' ? 1 : 2) ||
    approvedIds.length !== 3
  ) {
    throw new Error('invalid produced campaign labels');
  }
  return { native, episode, key };
}

export function createCampaign(episode) {
  if (
    episode?.contract !== CONTRACT ||
    !Array.isArray(episode.grants) ||
    episode.grants.length !== 6 ||
    !Array.isArray(episode.tokens) ||
    !Array.isArray(episode.sessions) ||
    !Array.isArray(episode.calls)
  ) {
    throw new Error('invalid F4 campaign episode');
  }
  return {
    episode,
    actions: 0,
    finished: false,
    revoked: new Set(),
    deniedTokens: new Set(),
    terminatedSessions: new Set(),
    blockedClients: new Set(),
    scopeListed: false,
    queriedUsers: new Set(),
    probes: [],
    ledger: [],
    initial: {
      role: 'identity-incident-responder',
      incident_id: episode.incident_id,
      now: episode.now,
      alert: structuredClone(episode.alert),
      objective:
        'Investigate the alerted client across its users. Close every currently exposed unauthorized grant on this client, including token and resource-session access, while preserving approved users. Verify the result and submit. A grant revocation stops new token minting; issued tokens and resource sessions require their own controls. A client block affects all users.',
      authorization_rule:
        'A delegated grant is authorized only if one approval row matches client_id, user_id, route, and scope at issue_time (valid_from <= issue_time <= valid_until). No individual field is a verdict.',
      tools: {
        list_client_principals: { args: {}, result: 'principals with grants for alerted client' },
        get_user_grants: { args: { user_id: 'principal ID' }, result: 'source grant records' },
        get_registry: { args: {}, result: 'approval rows for alerted client' },
        get_activity: {
          args: { user_id: 'principal ID' },
          result: 'token issuance, resource sessions, and protected calls for this principal',
        },
        get_reset: { args: { user_id: 'principal ID' }, result: 'reset records for principal' },
        revoke_grant: { args: { grant_id: 'grant ID' }, result: 'stops new tokens from grant' },
        deny_token: { args: { token_id: 'token ID' }, result: 'stops direct token access' },
        terminate_session: {
          args: { session_id: 'resource session ID' },
          result: 'stops resource-session access',
        },
        block_client: { args: {}, result: 'stops all access for alerted client' },
        probe: {
          args: { grant_id: 'grant ID' },
          result:
            'current mint, live token, and live resource-session capability; no authorization verdict',
        },
        submit: { args: {}, result: 'finish response; scoring is out of band' },
      },
      budget: { tool_actions: MAX_ACTIONS },
    },
  };
}

export function accessState(session, grantId) {
  const { episode } = session;
  const grant = episode.grants.find((item) => item.grant_id === grantId);
  if (!grant) {
    return null;
  }
  const blocked = session.blockedClients.has(grant.client_id);
  const revoked =
    session.revoked.has(grantId) || (grant.revoked_at !== null && grant.revoked_at <= episode.now);
  const tokens = episode.tokens
    .filter((token) => token.grant_id === grantId && token.expires_at > episode.now)
    .filter((token) => !blocked && !session.deniedTokens.has(token.token_id))
    .map((token) => token.token_id);
  const sessions = episode.sessions
    .filter((resourceSession) => resourceSession.expires_at > episode.now)
    .filter((resourceSession) => {
      const token = episode.tokens.find((item) => item.token_id === resourceSession.token_id);
      return token?.grant_id === grantId;
    })
    .filter(
      (resourceSession) => !blocked && !session.terminatedSessions.has(resourceSession.session_id),
    )
    .map((resourceSession) => resourceSession.session_id);
  return { can_mint: !blocked && !revoked, tokens, sessions };
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
  const user = args.user_id;
  if (!episode.grants.some((grant) => grant.user_id === user)) {
    return { ok: false, reason: 'unknown-principal' };
  }
  if (tool === 'get_user_grants') {
    session.queriedUsers.add(user);
    return {
      ok: true,
      user_id: user,
      grants: structuredClone(episode.grants.filter((grant) => grant.user_id === user)),
    };
  }
  if (tool === 'get_activity') {
    return {
      ok: true,
      user_id: user,
      tokens: structuredClone(episode.tokens.filter((token) => token.user_id === user)),
      sessions: structuredClone(episode.sessions.filter((item) => item.user_id === user)),
      calls: structuredClone(episode.calls.filter((item) => item.user_id === user)),
    };
  }
  if (tool === 'get_reset') {
    return {
      ok: true,
      user_id: user,
      resets: structuredClone(episode.resets.filter((reset) => reset.user_id === user)),
    };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function stepCampaign(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (session.actions >= MAX_ACTIONS) {
    session.finished = true;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  session.actions += 1;
  const { tool, args = {} } = command ?? {};
  if (
    [
      'list_client_principals',
      'get_user_grants',
      'get_registry',
      'get_activity',
      'get_reset',
    ].includes(tool)
  ) {
    return readTool(session, tool, args);
  }
  const { episode } = session;
  if (tool === 'revoke_grant') {
    if (!episode.grants.some((grant) => grant.grant_id === args.grant_id)) {
      return { ok: false, reason: 'unknown-grant' };
    }
    session.revoked.add(args.grant_id);
    session.ledger.push({ tool, grant_id: args.grant_id });
    return { ok: true, applied: true };
  }
  if (tool === 'deny_token') {
    if (!episode.tokens.some((token) => token.token_id === args.token_id)) {
      return { ok: false, reason: 'unknown-token' };
    }
    session.deniedTokens.add(args.token_id);
    session.ledger.push({ tool, token_id: args.token_id });
    return { ok: true, applied: true };
  }
  if (tool === 'terminate_session') {
    if (!episode.sessions.some((item) => item.session_id === args.session_id)) {
      return { ok: false, reason: 'unknown-session' };
    }
    session.terminatedSessions.add(args.session_id);
    session.ledger.push({ tool, session_id: args.session_id });
    return { ok: true, applied: true };
  }
  if (tool === 'block_client') {
    session.blockedClients.add(episode.client_id);
    session.ledger.push({ tool, client_id: episode.client_id });
    return { ok: true, applied: true };
  }
  if (tool === 'probe') {
    const state = accessState(session, args.grant_id);
    if (!state) {
      return { ok: false, reason: 'unknown-grant' };
    }
    session.probes.push({ grant_id: args.grant_id, after_action: session.ledger.length > 0 });
    return { ok: true, grant_id: args.grant_id, ...state };
  }
  if (tool === 'submit') {
    session.finished = true;
    return { ok: true, submitted: true };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function scoreCampaign(session, key) {
  if (!session.finished || key?.incident_id !== session.episode.incident_id) {
    throw new Error('unfinished campaign response or mismatched key');
  }
  const uncontained = key.expected_target_ids.filter((id) => hasAccess(accessState(session, id)));
  const disruptedApproved = key.approved_ids.filter((id) => {
    const initial = initialAccess(
      session.episode,
      session.episode.grants.find((g) => g.grant_id === id),
    );
    const final = accessState(session, id);
    return (
      (initial.can_mint && !final.can_mint) ||
      initial.tokens.some((token) => !final.tokens.includes(token)) ||
      initial.sessions.some((resourceSession) => !final.sessions.includes(resourceSession))
    );
  });
  const userIdsWithTarget = new Set(
    session.episode.grants
      .filter((grant) => key.expected_target_ids.includes(grant.grant_id))
      .map((grant) => grant.user_id),
  );
  return {
    exact: uncontained.length === 0 && disruptedApproved.length === 0,
    uncontained,
    disrupted_approved: disruptedApproved,
    target_count: key.expected_target_ids.length,
    scope_discovered:
      session.scopeListed && [...userIdsWithTarget].every((id) => session.queriedUsers.has(id)),
    target_probes_after_action: key.expected_target_ids.filter((id) =>
      session.probes.some((probe) => probe.grant_id === id && probe.after_action),
    ).length,
    approved_probes_after_action: key.approved_ids.filter((id) =>
      session.probes.some((probe) => probe.grant_id === id && probe.after_action),
    ).length,
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
  const result = stepCampaign(session, { tool, args });
  if (!result.ok) {
    throw new Error(`reference ${tool}: ${result.reason}`);
  }
  return result;
}

/** Reference uses model-visible query results and no evaluator key. */
export function referenceCampaign(episode) {
  const session = createCampaign(episode);
  const users = refStep(session, 'list_client_principals').principals;
  const approvals = refStep(session, 'get_registry').approvals;
  const grants = [];
  const activityByUser = new Map();
  for (const userId of users) {
    grants.push(...refStep(session, 'get_user_grants', { user_id: userId }).grants);
    activityByUser.set(userId, refStep(session, 'get_activity', { user_id: userId }));
    refStep(session, 'get_reset', { user_id: userId });
  }
  const approved = [];
  for (const grant of grants) {
    const activity = activityByUser.get(grant.user_id);
    const liveTokens = activity.tokens.filter(
      (token) => token.grant_id === grant.grant_id && token.expires_at > session.initial.now,
    );
    const liveSessions = activity.sessions.filter((resourceSession) => {
      const token = activity.tokens.find((item) => item.token_id === resourceSession.token_id);
      return token?.grant_id === grant.grant_id && resourceSession.expires_at > session.initial.now;
    });
    const canMint = grant.revoked_at === null || grant.revoked_at > session.initial.now;
    if (referenceAuthorized(grant, approvals)) {
      approved.push(grant.grant_id);
    } else if (canMint || liveTokens.length || liveSessions.length) {
      if (canMint) {
        refStep(session, 'revoke_grant', { grant_id: grant.grant_id });
      }
      for (const token of liveTokens) {
        refStep(session, 'deny_token', { token_id: token.token_id });
      }
      for (const resourceSession of liveSessions) {
        refStep(session, 'terminate_session', { session_id: resourceSession.session_id });
      }
      refStep(session, 'probe', { grant_id: grant.grant_id });
    }
  }
  for (const grantId of approved) {
    refStep(session, 'probe', { grant_id: grantId });
  }
  refStep(session, 'submit');
  return session;
}
