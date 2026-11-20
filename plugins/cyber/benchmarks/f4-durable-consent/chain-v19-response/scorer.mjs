import { isDeepStrictEqual } from 'node:util';

import { authorizedByJoin } from '../shared/estate.mjs';
import { LIMITS, RESPONSE_CONTRACT_ID } from './config.mjs';
import { accessState, createResponse, stepResponse } from './engine.mjs';

const FINDING_FIELDS = [
  'grant_id',
  'created_event_id',
  'reset_event_id',
  'token_event_id',
  'call_event_id',
];

function byId(items, idField) {
  return new Map(items.map((item) => [item[idField], item]));
}

function sameCitation(candidate, expected) {
  return FINDING_FIELDS.every((field) => candidate[field] === expected[field]);
}

function quarantineSnapshot(session, userId, targetGrantIds) {
  const nextExportTick = session.now_tick < LIMITS.horizon_tick ? session.now_tick + 1 : null;
  const tokens = byId([...session.sources.tokens, ...session.dynamic_tokens], 'token_id');
  const sessions = byId(session.sources.sessions, 'session_id');
  return session.sources.grants
    .filter((grant) => grant.principal_binding === userId && targetGrantIds.has(grant.grant_id))
    .map((grant) => {
      const state = accessState(session, grant.grant_id);
      return {
        grant_id: grant.grant_id,
        can_mint: state.can_mint,
        token_survives_next_export:
          nextExportTick !== null &&
          state.live_token_ids.some((tokenId) => {
            const token = tokens.get(tokenId);
            return !token || token.expires_at_tick > nextExportTick;
          }),
        sessions_terminable: state.live_session_ids.every((sessionId) => sessions.has(sessionId)),
      };
    });
}

/** Reconstruct the observed action trace from the native estate and evaluator-only lag. */
function replayRecorded(session, key) {
  if (
    !session ||
    !key ||
    session.incident_id !== key.incident_id ||
    !Array.isArray(session.action_ledger) ||
    !key.revocation_lag_ticks
  ) {
    throw new Error('invalid response session or evaluator key');
  }
  const replay = createResponse({
    contract_id: RESPONSE_CONTRACT_ID,
    incident_id: session.incident_id,
    sources: session.sources,
    hidden: { revocation_lag_ticks: key.revocation_lag_ticks },
    initial: session.initial,
  });
  const targetGrantIds = new Set(nativeCitations(replay.sources).keys());
  const quarantineSnapshots = new Map();
  for (const [position, entry] of session.action_ledger.entries()) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Object.hasOwn(entry, 'command') ||
      entry.index !== position + 1 ||
      (typeof entry.tool !== 'string' && (entry.ok || entry.tool !== null)) ||
      typeof entry.ok !== 'boolean' ||
      typeof entry.counts_toward_budget !== 'boolean' ||
      entry.tick_before !== replay.now_tick
    ) {
      throw new Error('invalid response action ledger');
    }
    const snapshot =
      entry.command?.tool === 'set_quarantine' && entry.command.args?.on === true
        ? quarantineSnapshot(replay, entry.command.args.user_id, targetGrantIds)
        : null;
    // The engine records a JSON-safe copy of the entire command, including
    // malformed wrapper fields. Replay it without consulting the claimed error.
    const result = stepResponse(replay, entry.command);
    const replayedEntry = replay.action_ledger.at(-1);
    if (
      replayedEntry.counts_toward_budget !== entry.counts_toward_budget ||
      replayedEntry.tool !== entry.tool ||
      result.ok !== entry.ok ||
      entry.tick_after !== replay.now_tick ||
      replayedEntry.error_code !== entry.error_code ||
      !isDeepStrictEqual(replayedEntry.command, entry.command) ||
      !isDeepStrictEqual(replayedEntry.args, entry.args) ||
      !isDeepStrictEqual(result, entry.result)
    ) {
      throw new Error('response action ledger disagrees with native replay');
    }
    if (result.ok && snapshot) {
      quarantineSnapshots.set(replayedEntry.index, snapshot);
    }
  }
  if (replay.action_count !== session.action_count || replay.submitted !== session.submitted) {
    throw new Error('response action count or submission disagrees with native replay');
  }
  return { replay, quarantineSnapshots };
}

/** Derive observed unauthorized post-reset calls from causal native events. */
function nativeCitations(sources) {
  const events = byId(sources.events, 'event_id');
  const grants = byId(sources.grants, 'grant_id');
  const tokens = byId(sources.tokens, 'event_id');
  const resets = byId(sources.resets, 'compromised_user');
  const expected = new Map();
  for (const call of sources.events) {
    if (call.kind !== 'protected-export-call' || call.resource !== sources.client.protected_scope) {
      continue;
    }
    const tokenEvent = events.get(call.token_event_id);
    const token = tokens.get(call.token_event_id);
    const grant = grants.get(tokenEvent?.grant_id);
    const created = events.get(grant?.created_event_id);
    const reset = resets.get(grant?.principal_binding);
    const resetEvent = events.get(reset?.reset_event_id);
    if (
      tokenEvent?.kind !== 'access-token-issued' ||
      !token ||
      !grant ||
      created?.kind !== 'delegated-grant-created' ||
      resetEvent?.kind !== 'compromised-user-remediated' ||
      token.event_id !== tokenEvent.event_id ||
      token.token_id !== tokenEvent.token_id ||
      token.grant_id !== grant.grant_id ||
      token.client_id !== grant.client_id ||
      tokenEvent.client_id !== grant.client_id ||
      tokenEvent.created_event_id !== created.event_id ||
      tokenEvent.credential_lineage !== grant.refresh_lineage ||
      tokenEvent.caused_by_event_id !== created.event_id ||
      created.grant_id !== grant.grant_id ||
      created.client_id !== grant.client_id ||
      created.principal_binding !== grant.principal_binding ||
      created.credential_lineage !== grant.refresh_lineage ||
      resetEvent.compromised_user !== grant.principal_binding ||
      tokenEvent.reset_event_id !== reset.reset_event_id ||
      call.caused_by_event_id !== tokenEvent.event_id ||
      call.client_id !== grant.client_id ||
      grant.issue_time >= reset.reset_time ||
      tokenEvent.source_time <= reset.reset_time ||
      call.source_time <= tokenEvent.source_time ||
      reset.revoked_grant_ids.includes(grant.grant_id) ||
      authorizedByJoin(grant, sources.registry, grant.issue_time)
    ) {
      continue;
    }
    const citation = {
      grant_id: grant.grant_id,
      created_event_id: created.event_id,
      reset_event_id: reset.reset_event_id,
      token_event_id: tokenEvent.event_id,
      call_event_id: call.event_id,
    };
    const list = expected.get(grant.grant_id) ?? [];
    list.push(citation);
    expected.set(grant.grant_id, list);
  }
  return expected;
}

function attribution(sources, findings, expected) {
  const grantById = byId(sources.grants, 'grant_id');
  const submitted = Array.isArray(findings) ? findings : [];
  const correctIds = new Set();
  const falsePositiveIds = [];
  const citationErrorIds = [];
  const survivorFalsePositiveIds = [];
  const noCallFalsePositiveIds = [];
  for (const finding of submitted) {
    const citations = expected.get(finding.grant_id);
    if (citations?.some((citation) => sameCitation(finding, citation))) {
      correctIds.add(finding.grant_id);
      continue;
    }
    if (citations) {
      citationErrorIds.push(finding.grant_id);
      continue;
    }
    falsePositiveIds.push(finding.grant_id);
    const grant = grantById.get(finding.grant_id);
    if (grant && authorizedByJoin(grant, sources.registry, grant.issue_time)) {
      survivorFalsePositiveIds.push(finding.grant_id);
    } else if (grant) {
      noCallFalsePositiveIds.push(finding.grant_id);
    }
  }
  const falseNegativeIds = [...expected.keys()].filter((grantId) => !correctIds.has(grantId));
  return {
    true_positives: correctIds.size,
    false_positives: falsePositiveIds.length,
    false_negatives: falseNegativeIds.length,
    survivor_false_positives: survivorFalsePositiveIds.length,
    no_call_false_positives: noCallFalsePositiveIds.length,
    citation_errors: citationErrorIds.length,
    false_positive_grant_ids: falsePositiveIds,
    false_negative_grant_ids: falseNegativeIds,
    citation_error_grant_ids: citationErrorIds,
    survivor_false_positive_grant_ids: survivorFalsePositiveIds,
    no_call_false_positive_grant_ids: noCallFalsePositiveIds,
    expected_target_count: expected.size,
  };
}

function relevantToGrant(entry, grant, sourceSessionById, sourceTokenById) {
  if (!entry.ok) {
    return false;
  }
  if (entry.tool === 'advance' || entry.tool === 'block_client') {
    return true;
  }
  if (entry.tool === 'revoke_grant') {
    return entry.args.grant_id === grant.grant_id;
  }
  if (entry.tool === 'set_quarantine') {
    return entry.args.user_id === grant.principal_binding;
  }
  if (entry.tool === 'terminate_session') {
    const resource = sourceSessionById.get(entry.args.session_id);
    return sourceTokenById.get(resource?.token_id)?.grant_id === grant.grant_id;
  }
  return false;
}

function probeState(entry, grant) {
  if (!entry.ok) {
    return null;
  }
  if (entry.tool === 'probe' && entry.args.grant_id === grant.grant_id) {
    return entry.result.data;
  }
  if (entry.tool === 'probe_user' && entry.args.user_id === grant.principal_binding) {
    return entry.result.data.grants.find((row) => row.grant_id === grant.grant_id) ?? null;
  }
  return null;
}

function isSafeProbe(state) {
  return (
    state.can_mint === false &&
    state.live_token_ids.length === 0 &&
    state.live_session_ids.length === 0
  );
}

function probeInRange(entry, grant, lower, upper, tick) {
  return (
    probeState(entry, grant) !== null &&
    entry.index > lower &&
    entry.index < upper &&
    entry.tick_before === tick
  );
}

function approvedReleaseVerified(ledger, release, approved, sourceSessionById, sourceTokenById) {
  return approved.every((grant) => {
    const nextRelevant =
      ledger.find(
        (entry) =>
          entry.index > release.index &&
          relevantToGrant(entry, grant, sourceSessionById, sourceTokenById),
      )?.index ?? Number.POSITIVE_INFINITY;
    return ledger.some(
      (entry) =>
        probeInRange(entry, grant, release.index, nextRelevant, release.tick_before) &&
        probeState(entry, grant).protected_access_allowed === true,
    );
  });
}

function evidenceFor(replay, expected) {
  const ledger = replay.action_ledger;
  const sources = replay.sources;
  const grants = byId(sources.grants, 'grant_id');
  const sourceSessionById = byId(sources.sessions, 'session_id');
  const sourceTokenById = byId(sources.tokens, 'token_id');
  const targetIds = [...expected.keys()];
  const missingFinalProbeGrantIds = [];
  for (const grantId of targetIds) {
    const grant = grants.get(grantId);
    const lastRelevant =
      ledger
        .filter((entry) => relevantToGrant(entry, grant, sourceSessionById, sourceTokenById))
        .at(-1)?.index ?? 0;
    const observed = ledger.some((entry) =>
      probeInRange(entry, grant, lastRelevant, Number.POSITIVE_INFINITY, LIMITS.horizon_tick),
    );
    if (!observed) {
      missingFinalProbeGrantIds.push(grantId);
    }
  }
  const missingDeliveryReadJobIds = [];
  for (const job of sources.jobs) {
    const observed = ledger.some(
      (entry) =>
        entry.ok &&
        entry.tool === 'get_deliveries' &&
        entry.tick_before >= job.due_tick &&
        entry.result.data.some((record) => record.job_id === job.job_id),
    );
    if (!observed) {
      missingDeliveryReadJobIds.push(job.job_id);
    }
  }
  const earlyReleaseUsers = [];
  const missingPostReleaseProbeUsers = [];
  for (const release of ledger.filter(
    (entry) => entry.ok && entry.tool === 'set_quarantine' && entry.args.on === false,
  )) {
    const userId = release.args.user_id;
    const unauthorized = sources.grants.filter(
      (grant) =>
        grant.principal_binding === userId &&
        !authorizedByJoin(grant, sources.registry, grant.issue_time),
    );
    const approved = sources.grants.filter(
      (grant) =>
        grant.principal_binding === userId &&
        authorizedByJoin(grant, sources.registry, grant.issue_time),
    );
    let safeToRelease = true;
    let postReleaseVerified = true;
    for (const grant of unauthorized) {
      const lastRelevant =
        ledger
          .filter(
            (entry) =>
              entry.index < release.index &&
              relevantToGrant(entry, grant, sourceSessionById, sourceTokenById),
          )
          .at(-1)?.index ?? 0;
      const before = ledger.findLast((entry) =>
        probeInRange(entry, grant, lastRelevant, release.index, release.tick_before),
      );
      if (!before || !isSafeProbe(probeState(before, grant))) {
        safeToRelease = false;
      }
      const nextRelevant =
        ledger.find(
          (entry) =>
            entry.index > release.index &&
            relevantToGrant(entry, grant, sourceSessionById, sourceTokenById),
        )?.index ?? Number.POSITIVE_INFINITY;
      const after = ledger.find((entry) =>
        probeInRange(entry, grant, release.index, nextRelevant, release.tick_before),
      );
      const afterState = after ? probeState(after, grant) : null;
      if (
        !afterState ||
        !isSafeProbe(afterState) ||
        afterState.protected_access_allowed !== false
      ) {
        postReleaseVerified = false;
      }
    }
    if (!approvedReleaseVerified(ledger, release, approved, sourceSessionById, sourceTokenById)) {
      postReleaseVerified = false;
    }
    if (!safeToRelease) {
      earlyReleaseUsers.push(userId);
    }
    if (!postReleaseVerified) {
      missingPostReleaseProbeUsers.push(userId);
    }
  }
  return {
    missing_final_probe_grant_ids: missingFinalProbeGrantIds,
    missing_delivery_read_job_ids: missingDeliveryReadJobIds,
    early_release_users: [...new Set(earlyReleaseUsers)],
    missing_post_release_probe_users: [...new Set(missingPostReleaseProbeUsers)],
  };
}

function outcomesFor(replay, expected, evidence, quarantineSnapshots) {
  const sources = replay.sources;
  const targetIds = [...expected.keys()];
  const targetUsers = new Set(
    sources.grants
      .filter((grant) => expected.has(grant.grant_id))
      .map((grant) => grant.principal_binding),
  );
  const unauthorizedExports = replay.protected_attempts.filter(
    (attempt) => expected.has(attempt.grant_id) && attempt.succeeded,
  );
  const liveUnauthorizedPathIds = targetIds.filter((grantId) => {
    const state = accessState(replay, grantId);
    return state.can_mint || state.live_token_ids.length > 0 || state.live_session_ids.length > 0;
  });
  const delivered = new Set(
    replay.dynamic_events
      .filter((event) => event.kind === 'approved-job-delivered')
      .map((event) => `${event.job_id}|${event.tick}`),
  );
  const missedJobIds = sources.jobs
    .filter((job) => !delivered.has(`${job.job_id}|${job.due_tick}`))
    .map((job) => job.job_id);
  const approvedGrants = sources.grants.filter((grant) =>
    authorizedByJoin(grant, sources.registry, grant.issue_time),
  );
  const approvedUnusableGrantIds = approvedGrants
    .filter((grant) => !accessState(replay, grant.grant_id).protected_access_allowed)
    .map((grant) => grant.grant_id);
  const approvedGrantIds = new Set(approvedGrants.map((grant) => grant.grant_id));
  const approvedRevokedGrantIds = replay.control_requests
    .filter((request) => approvedGrantIds.has(request.grant_id))
    .map((request) => request.grant_id);
  const approvedOnlyQuarantines = [];
  const avoidableSessionOnlyQuarantines = [];
  for (const entry of replay.action_ledger) {
    if (!entry.ok || entry.tool !== 'set_quarantine' || entry.args.on !== true) {
      continue;
    }
    const userId = entry.args.user_id;
    if (!targetUsers.has(userId)) {
      approvedOnlyQuarantines.push(userId);
      continue;
    }
    const states = quarantineSnapshots.get(entry.index);
    if (
      states?.length > 0 &&
      states.every(
        (state) =>
          !state.can_mint && !state.token_survives_next_export && state.sessions_terminable,
      )
    ) {
      avoidableSessionOnlyQuarantines.push(userId);
    }
  }
  return {
    client_blocked: replay.client_blocked,
    unauthorized_exports: unauthorizedExports.length,
    unauthorized_export_event_ids: unauthorizedExports.map((attempt) => attempt.event_id),
    live_unauthorized_path_ids: liveUnauthorizedPathIds,
    missed_jobs: missedJobIds.length,
    missed_job_ids: missedJobIds,
    delivered_jobs: sources.jobs.length - missedJobIds.length,
    approved_unusable_grant_ids: approvedUnusableGrantIds,
    approved_revoked_grant_ids: [...new Set(approvedRevokedGrantIds)],
    approved_only_quarantines: [...new Set(approvedOnlyQuarantines)],
    avoidable_session_only_quarantines: [...new Set(avoidableSessionOnlyQuarantines)],
    final_quarantined_user_ids: [...replay.quarantined_user_ids],
    early_release_users: evidence.early_release_users,
  };
}

/** Score citations, replayed effects, legitimate work, restoration, and observed evidence. */
export function scoreResponse(session, key) {
  const { replay, quarantineSnapshots } = replayRecorded(session, key);
  const expected = nativeCitations(replay.sources);
  const submitted = replay.submitted && replay.now_tick === LIMITS.horizon_tick;
  const findings = attribution(replay.sources, replay.findings, expected);
  const evidence = evidenceFor(replay, expected);
  const outcomes = outcomesFor(replay, expected, evidence, quarantineSnapshots);
  const stages = {
    attribution:
      submitted &&
      findings.false_positives === 0 &&
      findings.false_negatives === 0 &&
      findings.citation_errors === 0,
    provisional_containment: submitted && outcomes.unauthorized_exports === 0,
    job_continuity: submitted && outcomes.missed_jobs === 0,
    revocation_session_closure: submitted && outcomes.live_unauthorized_path_ids.length === 0,
    recovery:
      submitted &&
      !outcomes.client_blocked &&
      outcomes.live_unauthorized_path_ids.length === 0 &&
      outcomes.approved_unusable_grant_ids.length === 0 &&
      outcomes.approved_revoked_grant_ids.length === 0 &&
      outcomes.approved_only_quarantines.length === 0 &&
      outcomes.avoidable_session_only_quarantines.length === 0 &&
      outcomes.final_quarantined_user_ids.length === 0 &&
      evidence.early_release_users.length === 0,
    evidence_verification:
      submitted &&
      evidence.missing_final_probe_grant_ids.length === 0 &&
      evidence.missing_delivery_read_job_ids.length === 0 &&
      evidence.early_release_users.length === 0 &&
      evidence.missing_post_release_probe_users.length === 0,
  };
  const exact = Object.values(stages).every(Boolean);
  return {
    exact,
    classification: submitted ? (exact ? 'exact' : 'model-fail') : 'unscored',
    stages,
    attribution: findings,
    outcomes,
    evidence,
    usage: {
      actions: replay.action_count,
      tool_invocations: session.action_ledger.length,
      turns: null,
      completion_tokens: null,
    },
  };
}
