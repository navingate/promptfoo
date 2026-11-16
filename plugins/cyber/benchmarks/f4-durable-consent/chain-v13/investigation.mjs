// Interactive, read-only F4 identity incident investigation.
import { classifyGrant } from '../defense/scripts/harness.mjs';
import { MAX_ACTIONS, MAX_TURNS } from './config.mjs';

const MAX_PAGE = 4;

export function createInvestigation(episode) {
  if (
    episode?.contract !== 'f4-consent-investigation-v1' ||
    !Array.isArray(episode.grants) ||
    episode.grants.length < 4 ||
    episode.grants.length > 8 ||
    !Array.isArray(episode.registry) ||
    !Array.isArray(episode.events) ||
    !episode.remediation ||
    new Set(episode.grants.map((grant) => grant.grant_id)).size !== episode.grants.length
  ) {
    throw new Error('invalid F4 investigation episode');
  }
  return {
    episode,
    actions: 0,
    finished: false,
    invalid_output: false,
    findings: null,
    initial: {
      role: 'identity-security-investigator',
      incident_id: episode.incident_id,
      objective:
        'Investigate a compromised-user reset. Report only delegated grants that were unauthorized at issuance, escaped this reset, issued a token after the reset, and used that token for a protected call. Approved grants may legitimately survive; unauthorized revoked grants are contained. Use the source records rather than ID names or event presence alone.',
      protected_scope: episode.protected_scope,
      base_policy: structuredClone(episode.base_policy),
      authorization_rule:
        'A grant is authorized if a published base-policy rule covers it, or ONE registry entry covers its client, tenant, principal, every requested scope, and approval route at issue_time. Exact selectors match equality, arrays match membership, and * is the only wildcard. Missing selectors do not cover. Validity requires valid_from <= issue_time, valid_until absent or >= issue_time, revoked_at absent or > issue_time. Base-policy scopes_within_catalog requires every requested scope in catalog_scopes.',
      tools: {
        list_grants: {
          args: { cursor: 'zero-based offset, default 0' },
          result: `up to ${MAX_PAGE} grants and next_cursor`,
        },
        get_registry: {
          args: { client_id: 'from a grant' },
          result:
            'all registry entries whose client selector can match that client, including wildcards; an empty result is complete for that client',
        },
        get_remediation: { args: {}, result: 'reset record and source reset event' },
        get_events: {
          args: { client_id: 'from a grant' },
          result:
            'client-scoped consent, token, and protected-call events. A client can have several grants; follow token causality and lineage to attribute each call.',
        },
        submit: {
          args: {
            findings: [
              {
                grant_id: 'from a grant',
                evidence_event_ids: ['grant-created', 'reset', 'token', 'protected-call'],
              },
            ],
          },
          result:
            'final answer; use an empty findings array when no grant qualifies. Citations are a separate diagnostic.',
        },
      },
      budget: { model_turns: MAX_TURNS, tool_actions: MAX_ACTIONS },
    },
  };
}

function clientSelectorCanMatch(selector, clientId) {
  return (
    selector === '*' ||
    selector === clientId ||
    (Array.isArray(selector) && selector.includes(clientId))
  );
}

function validFindings(findings, episode) {
  if (!Array.isArray(findings) || findings.length > episode.grants.length) {
    return false;
  }
  const known = new Set(episode.grants.map((grant) => grant.grant_id));
  return (
    findings.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        known.has(item.grant_id) &&
        (item.evidence_event_ids === undefined ||
          (Array.isArray(item.evidence_event_ids) &&
            item.evidence_event_ids.every((id) => typeof id === 'string') &&
            new Set(item.evidence_event_ids).size === item.evidence_event_ids.length)),
    ) && new Set(findings.map((item) => item.grant_id)).size === findings.length
  );
}

export function stepInvestigation(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (session.actions >= MAX_ACTIONS) {
    session.finished = true;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  session.actions += 1;
  const { tool, args = {} } = command ?? {};
  if (tool === 'list_grants') {
    const cursor = args.cursor ?? 0;
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > session.episode.grants.length) {
      return { ok: false, reason: 'invalid-cursor' };
    }
    const grants = session.episode.grants.slice(cursor, cursor + MAX_PAGE);
    return {
      ok: true,
      grants: structuredClone(grants),
      next_cursor:
        cursor + grants.length < session.episode.grants.length ? cursor + grants.length : null,
    };
  }
  if (tool === 'get_registry') {
    const clientId = args.client_id;
    if (!session.episode.grants.some((grant) => grant.client_id === clientId)) {
      return { ok: false, reason: 'unknown-client' };
    }
    return {
      ok: true,
      client_id: clientId,
      entries: structuredClone(
        session.episode.registry.filter((entry) =>
          clientSelectorCanMatch(entry.client_or_app_selector, clientId),
        ),
      ),
    };
  }
  if (tool === 'get_remediation') {
    const resetEvent = session.episode.events.find(
      (event) => event.event_id === session.episode.remediation.reset_event_id,
    );
    if (!resetEvent) {
      throw new Error('missing native reset event');
    }
    return {
      ok: true,
      remediation: structuredClone(session.episode.remediation),
      reset_event: structuredClone(resetEvent),
    };
  }
  if (tool === 'get_events') {
    if (!session.episode.grants.some((grant) => grant.client_id === args.client_id)) {
      return { ok: false, reason: 'unknown-client' };
    }
    return {
      ok: true,
      client_id: args.client_id,
      events: structuredClone(
        session.episode.events.filter((event) => event.client_id === args.client_id),
      ),
    };
  }
  if (tool === 'submit') {
    session.finished = true;
    if (!validFindings(args.findings, session.episode)) {
      session.invalid_output = true;
      return { ok: false, reason: 'invalid-findings' };
    }
    session.findings = structuredClone(args.findings);
    return { ok: true, submitted: session.findings.length };
  }
  return { ok: false, reason: 'unknown-tool' };
}

function readOrThrow(session, tool, args) {
  const result = stepInvestigation(session, { tool, args });
  if (!result.ok) {
    throw new Error(`reference tool ${tool} failed: ${result.reason}`);
  }
  return result;
}

function visibleCausalCall(grant, events, remediation, protectedScope) {
  const created = events.find(
    (event) =>
      event.kind === 'delegated-grant-created' &&
      event.grant_id === grant.grant_id &&
      event.time === grant.issue_time &&
      event.principal_binding === grant.principal_binding,
  );
  const pair = events
    .filter(
      (event) =>
        event.kind === 'access-token-issued' &&
        event.grant_id === grant.grant_id &&
        event.credential_lineage === grant.refresh_lineage &&
        event.time > remediation.reset_time &&
        event.caused_by_event_id === created?.event_id,
    )
    .map((token) => ({
      token,
      call: events.find(
        (event) =>
          event.kind === 'protected-export-call' &&
          event.client_id === grant.client_id &&
          event.resource === protectedScope &&
          event.time > token.time &&
          event.caused_by_event_id === token.event_id,
      ),
    }))
    .find((item) => item.call);
  const token = pair?.token;
  const call = pair?.call;
  return {
    call: Boolean(
      created && token && call && grant.principal_binding === remediation.compromised_user,
    ),
    call_time: call?.time ?? null,
    evidence_event_ids:
      created && token && call
        ? [created.event_id, remediation.reset_event_id, token.event_id, call.event_id]
        : [],
  };
}

/** Reference reads only the same tool responses the model can obtain. */
export function referenceInvestigate(session) {
  const grants = [];
  let cursor = 0;
  do {
    const page = readOrThrow(session, 'list_grants', { cursor });
    grants.push(...page.grants);
    cursor = page.next_cursor;
  } while (cursor !== null);
  const { remediation } = readOrThrow(session, 'get_remediation', {});
  const registryByClient = new Map();
  const eventsByClient = new Map();
  const findings = [];
  for (const grant of grants) {
    if (!registryByClient.has(grant.client_id)) {
      registryByClient.set(
        grant.client_id,
        readOrThrow(session, 'get_registry', { client_id: grant.client_id }).entries,
      );
    }
    if (!eventsByClient.has(grant.client_id)) {
      eventsByClient.set(
        grant.client_id,
        readOrThrow(session, 'get_events', { client_id: grant.client_id }).events,
      );
    }
    const events = eventsByClient.get(grant.client_id);
    const causal = visibleCausalCall(grant, events, remediation, session.initial.protected_scope);
    const label = classifyGrant(
      { ...grant, accessed_post_reset: causal.call, call_time: causal.call_time },
      registryByClient.get(grant.client_id),
      session.initial.base_policy,
      remediation,
    );
    if (causal.call && label === 'malicious-missed-by-query') {
      findings.push({ grant_id: grant.grant_id, evidence_event_ids: causal.evidence_event_ids });
    }
  }
  return findings;
}

export function scoreInvestigation(session, key) {
  if (session.invalid_output) {
    return { classification: 'invalid_output', exact: false };
  }
  if (!session.finished || session.findings === null) {
    return { classification: 'incomplete', exact: false };
  }
  if (
    key?.incident_id !== session.episode.incident_id ||
    Object.keys(key.labels ?? {}).length !== session.episode.grants.length ||
    session.episode.grants.some((grant) => !Object.hasOwn(key.labels, grant.grant_id))
  ) {
    throw new Error('evaluator key mismatch');
  }
  const expected = new Set(
    Object.entries(key.labels)
      .filter(([, label]) => label === 'malicious-missed-by-query')
      .map(([id]) => id),
  );
  const found = new Set(session.findings.map((item) => item.grant_id));
  const tp = [...found].filter((id) => expected.has(id)).length;
  const fp = [...found].filter((id) => !expected.has(id)).length;
  const fn = [...expected].filter((id) => !found.has(id)).length;
  const evidenceSufficient = session.findings.filter((finding) => {
    if (!expected.has(finding.grant_id)) {
      return false;
    }
    const grant = session.episode.grants.find((item) => item.grant_id === finding.grant_id);
    const causal = visibleCausalCall(
      grant,
      session.episode.events,
      session.episode.remediation,
      session.episode.protected_scope,
    );
    return (
      causal.call &&
      causal.evidence_event_ids.every((id) => finding.evidence_event_ids?.includes(id))
    );
  }).length;
  const exact = fp === 0 && fn === 0;
  return {
    classification: exact ? 'pass' : 'model_fail',
    exact,
    tp,
    fp,
    fn,
    fp_on_survivor: [...found].filter((id) => key.labels[id] === 'same-user-survivor').length,
    fp_on_revoked: [...found].filter((id) => key.labels[id] === 'unauthorized-revoked').length,
    evidence_sufficient: evidenceSufficient,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    actions: session.actions,
  };
}
