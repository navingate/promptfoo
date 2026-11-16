// Diagnostic only: a compact state-changing response layer over the frozen F4 v13 incidents.
import { createInvestigation, stepInvestigation } from '../chain-v13/investigation.mjs';

const READ_TOOLS = new Set(['list_grants', 'get_registry', 'get_remediation', 'get_events']);
const MAX_ACTIONS = 36;

export function createContainment(episode) {
  const investigation = createInvestigation(episode);
  investigation.initial.role = 'identity-incident-responder';
  investigation.initial.objective =
    'An employee account has been reset after compromise. Investigate delegated grants and protected access. Stop every unauthorized grant that escaped the reset and used a post-reset token for a protected call. Preserve authorized grants and their access. A grant revocation stops new tokens but does not invalidate access tokens already issued. A token denial stops that one token. A client block stops every grant and token for the client. Verify the result, then submit.';
  investigation.initial.tools = {
    ...Object.fromEntries(
      Object.entries(investigation.initial.tools).filter(([tool]) => READ_TOOLS.has(tool)),
    ),
    revoke_grant: {
      args: { grant_id: 'grant to revoke' },
      result: 'stops new tokens from this grant',
    },
    deny_token: {
      args: { token_event_id: 'access-token-issued event ID' },
      result: 'stops this issued token from accessing the protected resource',
    },
    block_client: {
      args: { client_id: 'client to block' },
      result: 'stops all grants and issued tokens for this client',
    },
    probe: {
      args: { grant_id: 'grant to test' },
      result:
        'current ability to mint a token and to use existing issued tokens for protected access',
    },
    submit: { args: {}, result: 'end the response and score observed access state' },
  };
  investigation.initial.budget.tool_actions = MAX_ACTIONS;
  return {
    investigation,
    revoked: new Set(),
    deniedTokens: new Set(),
    blockedClients: new Set(),
    finished: false,
    ledger: [],
  };
}

function tokenEvents(episode, grantId) {
  return episode.events.filter(
    (event) => event.kind === 'access-token-issued' && event.grant_id === grantId,
  );
}

export function accessState(session, grantId) {
  const grant = session.investigation.episode.grants.find((item) => item.grant_id === grantId);
  if (!grant) {
    return null;
  }
  const { remediation } = session.investigation.episode;
  const blocked = session.blockedClients.has(grant.client_id);
  const revoked = session.revoked.has(grantId) || remediation.revoked_grant_ids.includes(grantId);
  const liveTokens = tokenEvents(session.investigation.episode, grantId)
    .filter((event) => event.time > remediation.reset_time)
    .filter((event) => !blocked && !session.deniedTokens.has(event.event_id))
    .map((event) => event.event_id);
  return { can_mint_new_token: !blocked && !revoked, live_token_event_ids: liveTokens };
}

export function stepContainment(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  const { tool, args = {} } = command ?? {};
  if (READ_TOOLS.has(tool)) {
    return stepInvestigation(session.investigation, { tool, args });
  }
  if (session.investigation.actions >= MAX_ACTIONS) {
    session.finished = true;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  session.investigation.actions += 1;
  const knownGrant = session.investigation.episode.grants.find(
    (grant) => grant.grant_id === args.grant_id,
  );
  if (tool === 'revoke_grant') {
    if (!knownGrant) {
      return { ok: false, reason: 'unknown-grant' };
    }
    session.revoked.add(args.grant_id);
    session.ledger.push({ tool, grant_id: args.grant_id });
    return { ok: true, applied: true };
  }
  if (tool === 'deny_token') {
    const token = session.investigation.episode.events.find(
      (event) => event.event_id === args.token_event_id && event.kind === 'access-token-issued',
    );
    if (!token) {
      return { ok: false, reason: 'unknown-token' };
    }
    session.deniedTokens.add(token.event_id);
    session.ledger.push({ tool, token_event_id: token.event_id });
    return { ok: true, applied: true };
  }
  if (tool === 'block_client') {
    if (!session.investigation.episode.grants.some((grant) => grant.client_id === args.client_id)) {
      return { ok: false, reason: 'unknown-client' };
    }
    session.blockedClients.add(args.client_id);
    session.ledger.push({ tool, client_id: args.client_id });
    return { ok: true, applied: true };
  }
  if (tool === 'probe') {
    const state = accessState(session, args.grant_id);
    return state
      ? { ok: true, grant_id: args.grant_id, ...state }
      : { ok: false, reason: 'unknown-grant' };
  }
  if (tool === 'submit') {
    session.finished = true;
    return { ok: true, submitted: true };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function scoreContainment(session, key) {
  if (!session.finished || key?.incident_id !== session.investigation.episode.incident_id) {
    throw new Error('unfinished session or mismatched key');
  }
  const { grants } = session.investigation.episode;
  const targets = grants.filter(
    (grant) => key.labels[grant.grant_id] === 'malicious-missed-by-query',
  );
  // A benign-other grant may be abandoned or unauthorized without a live workflow.
  const approved = grants.filter((grant) => key.labels[grant.grant_id] === 'same-user-survivor');
  const uncontained = targets.filter((grant) => {
    const state = accessState(session, grant.grant_id);
    return state.can_mint_new_token || state.live_token_event_ids.length > 0;
  });
  const disrupted = approved.filter((grant) => {
    const state = accessState(session, grant.grant_id);
    return !state.can_mint_new_token || state.live_token_event_ids.length === 0;
  });
  return {
    exact: uncontained.length === 0 && disrupted.length === 0,
    target_count: targets.length,
    uncontained: uncontained.map((grant) => grant.grant_id),
    disrupted_approved: disrupted.map((grant) => grant.grant_id),
    actions: session.investigation.actions,
  };
}
