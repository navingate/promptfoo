import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizedByJoin } from '../shared/estate.mjs';
import { GRID, LIMITS } from './config.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { produceResponse, validateResponseNative } from './producer.mjs';

async function scorer() {
  const module = await import('./scorer.mjs').catch(() => null);
  assert.ok(module, 'native response scorer.mjs is missing');
  return module.scoreResponse;
}

function call(session, tool, args = {}) {
  const result = stepResponse(session, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${JSON.stringify(result.error)}`);
  return result.data;
}

function fixture(profile, lagVariant = null) {
  const spec = GRID.find(
    (item) => item.profile === profile && (lagVariant === null || item.lag_variant === lagVariant),
  );
  assert.ok(spec);
  return produceResponse(spec);
}

function grantsForUser(sources, userId, authorized) {
  return sources.grants.filter(
    (grant) =>
      grant.principal_binding === userId &&
      authorizedByJoin(grant, sources.registry, grant.issue_time) === authorized,
  );
}

function resourceSessionFor(sources, grantId) {
  const tokenIds = new Set(
    sources.tokens.filter((token) => token.grant_id === grantId).map((token) => token.token_id),
  );
  return sources.sessions.find((session) => tokenIds.has(session.token_id));
}

function prepareResponse(source, options) {
  const { episode, key } = source;
  const session = createResponse(episode);
  if (options.rejectedCommand) {
    assert.equal(stepResponse(session, null).ok, false);
  }
  const grants = new Map(episode.sources.grants.map((grant) => [grant.grant_id, grant]));
  const targets = key.target_grant_ids.map((grantId) => grants.get(grantId));
  const mintUsers = new Set(key.mint_user_ids);
  const standby = episode.sources.runners.find((runner) => runner.standby);
  const affectedUsers = new Set(targets.map((grant) => grant.principal_binding));
  if (options.noop) {
    return { session, key, episode, options, targets, mintUsers, standby };
  }
  if (options.broadQuarantine) {
    for (const principal of episode.sources.principals) {
      if (!affectedUsers.has(principal.user_id)) {
        call(session, 'set_quarantine', { user_id: principal.user_id, on: true });
      }
    }
  }
  if (options.revokeApproved) {
    const approved = episode.sources.jobs[0].approved_grant_id;
    call(session, 'revoke_grant', { grant_id: approved });
  }
  for (const grant of targets) {
    const userId = grant.principal_binding;
    if (mintUsers.has(userId)) {
      if (!options.revokeOnly) {
        call(session, 'set_quarantine', { user_id: userId, on: true });
      }
      call(session, 'revoke_grant', { grant_id: grant.grant_id });
    } else if (options.quarantineSessionOnly) {
      call(session, 'set_quarantine', { user_id: userId, on: true });
    }
    if (!options.revokeOnly) {
      const resource = resourceSessionFor(episode.sources, grant.grant_id);
      if (resource) {
        call(session, 'terminate_session', { session_id: resource.session_id });
      }
    }
  }
  return { session, key, episode, options, targets, mintUsers, standby };
}

function release(context, userId, withSafetyProbes = true) {
  const { session, episode, options } = context;
  const unauthorized = grantsForUser(episode.sources, userId, false);
  if (withSafetyProbes) {
    for (const grant of unauthorized) {
      call(session, 'probe', { grant_id: grant.grant_id });
    }
  }
  call(session, 'set_quarantine', { user_id: userId, on: false });
  if (withSafetyProbes && !options.omitPostReleaseProbes) {
    for (const grant of unauthorized) {
      call(session, 'probe', { grant_id: grant.grant_id });
    }
    for (const grant of grantsForUser(episode.sources, userId, true)) {
      call(session, 'probe', { grant_id: grant.grant_id });
    }
  }
}

function advanceResponse(context, tick) {
  const { session, episode, key, options, targets, mintUsers, standby } = context;
  call(session, 'advance');
  if (tick === 1 && options.staleProbe) {
    for (const grant of targets) {
      call(session, 'probe', { grant_id: grant.grant_id });
    }
  }
  if (tick <= 3) {
    for (const userId of mintUsers) {
      if (!session.quarantined_user_ids.includes(userId)) {
        continue;
      }
      const states = grantsForUser(episode.sources, userId, false).map((grant) =>
        call(session, 'probe', { grant_id: grant.grant_id }),
      );
      const safe = states.every(
        (state) =>
          !state.can_mint &&
          state.live_token_ids.length === 0 &&
          state.live_session_ids.length === 0,
      );
      if (safe && !options.fixedWait) {
        release(context, userId);
      } else if (tick === 2 && options.releaseAtTick2DespiteToken) {
        release(context, userId);
      } else if (tick === 1 && options.earlyRelease) {
        release(context, userId, false);
      }
    }
  }
  if (tick === 1 && key.profile === 'both-live') {
    const due = episode.sources.jobs.filter((job) => job.due_tick === 2);
    const chosen = options.wrongStandby
      ? due.find((job) => !session.quarantined_user_ids.includes(job.owner_user_id))
      : due.find((job) => session.quarantined_user_ids.includes(job.owner_user_id));
    if (chosen) {
      call(session, 'assign_job', { job_id: chosen.job_id, runner_id: standby.runner_id });
    }
  }
}

function response(source, options = {}) {
  const context = prepareResponse(source, options);
  const { session, key, episode, targets, mintUsers, standby } = context;
  if (options.noop || options.revokeOnly) {
    call(session, 'submit', {
      findings: options.findings?.(key.expected_findings) ?? key.expected_findings,
    });
    return { session, key, episode };
  }
  if (options.quarantineSessionOnly) {
    for (const userId of key.session_only_user_ids) {
      release(context, userId);
    }
  }
  if (!options.wrongStandby) {
    for (const job of episode.sources.jobs.filter(
      (item) => item.due_tick === 1 && mintUsers.has(item.owner_user_id),
    )) {
      call(session, 'assign_job', { job_id: job.job_id, runner_id: standby.runner_id });
    }
  }
  for (let tick = 1; tick <= LIMITS.horizon_tick; tick++) {
    advanceResponse(context, tick);
  }
  if (!options.omitFinalProbes && !options.staleProbe) {
    for (const grant of targets) {
      call(session, 'probe', { grant_id: grant.grant_id });
    }
  }
  if (!options.omitDeliveryRead) {
    call(session, 'get_deliveries');
  }
  call(session, 'submit', {
    findings: options.findings?.(key.expected_findings) ?? key.expected_findings,
  });
  return { session, key, episode };
}

test('native replay gives exact scores for all profiles, lag branches, and swapped-lag clones', async () => {
  const scoreResponse = await scorer();
  const specs = [
    ...GRID,
    ...GRID.filter((spec) => spec.profile === 'both-live').map((spec) => ({
      ...spec,
      swap_lag: true,
    })),
  ];
  for (const spec of specs) {
    const result = scoreResponse(
      response(produceResponse(spec)).session,
      produceResponse(spec).key,
    );
    assert.equal(
      result.exact,
      true,
      `${spec.seed}/${spec.profile}/${spec.swap_lag ?? false}: ${JSON.stringify(result)}`,
    );
    assert.equal(result.classification, 'exact');
    assert.deepEqual(Object.values(result.stages), [true, true, true, true, true, true]);
    assert.equal(result.outcomes.unauthorized_exports, 0);
    assert.equal(result.outcomes.missed_jobs, 0);
    assert.equal(result.attribution.false_positives, 0);
    assert.equal(result.attribution.false_negatives, 0);
    assert.equal(result.usage.actions <= LIMITS.tool_actions, true);
    assert.equal(result.usage.turns, null);
    assert.equal(result.usage.completion_tokens, null);
  }
});

test('wrong causal citations, approved survivors, omitted targets, and no-call grants fail attribution separately', async () => {
  const scoreResponse = await scorer();
  const source = fixture('single-mint', 0);
  const expected = source.key.expected_findings[0];
  for (const field of ['created_event_id', 'reset_event_id', 'token_event_id', 'call_event_id']) {
    const { session, key } = response(source, {
      findings: (findings) => [{ ...findings[0], [field]: `wrong-${field}` }],
    });
    const scored = scoreResponse(session, key);
    assert.equal(scored.stages.attribution, false, field);
    assert.equal(scored.attribution.citation_errors, 1, field);
    assert.equal(scored.stages.provisional_containment, true, field);
  }
  const survivor = source.episode.sources.grants.find((grant) =>
    authorizedByJoin(grant, source.episode.sources.registry, grant.issue_time),
  );
  const survivorCall = source.episode.sources.events.find((event) => {
    if (event.kind !== 'protected-export-call') {
      return false;
    }
    const token = source.episode.sources.events.find(
      (item) => item.event_id === event.token_event_id,
    );
    return token?.grant_id === survivor.grant_id;
  });
  const survivorToken = source.episode.sources.events.find(
    (event) => event.event_id === survivorCall.token_event_id,
  );
  const survivorReset = source.episode.sources.resets.find(
    (reset) => reset.compromised_user === survivor.principal_binding,
  );
  const survivorFinding = {
    grant_id: survivor.grant_id,
    created_event_id: survivor.created_event_id,
    reset_event_id: survivorReset.reset_event_id,
    token_event_id: survivorToken.event_id,
    call_event_id: survivorCall.event_id,
  };
  const flagged = response(source, { findings: (findings) => [...findings, survivorFinding] });
  const flaggedScore = scoreResponse(flagged.session, flagged.key);
  assert.equal(flaggedScore.attribution.survivor_false_positives, 1);
  assert.equal(flaggedScore.attribution.false_positives, 1);
  assert.equal(flaggedScore.stages.attribution, false);
  const omitted = response(source, { findings: () => [] });
  const omittedScore = scoreResponse(omitted.session, omitted.key);
  assert.equal(omittedScore.attribution.false_negatives, 1);
  assert.equal(omittedScore.stages.attribution, false);
  const inert = source.episode.sources.grants.find(
    (grant) =>
      grant.principal_binding ===
        source.episode.sources.grants.find((item) => item.grant_id === expected.grant_id)
          .principal_binding &&
      !authorizedByJoin(grant, source.episode.sources.registry, grant.issue_time) &&
      !source.episode.sources.events.some(
        (event) =>
          event.kind === 'protected-export-call' &&
          source.episode.sources.events.find((item) => item.event_id === event.token_event_id)
            ?.grant_id === grant.grant_id,
      ),
  );
  assert.ok(inert);
  const unsupported = response(source, {
    findings: (findings) => [
      ...findings,
      { ...findings[0], grant_id: inert.grant_id, created_event_id: inert.created_event_id },
    ],
  });
  const unsupportedScore = scoreResponse(unsupported.session, unsupported.key);
  assert.equal(unsupportedScore.attribution.no_call_false_positives, 1);
  assert.equal(unsupportedScore.stages.attribution, false);
});

test('no-op and revoke-only fail live containment and closure despite submitted findings', async () => {
  const scoreResponse = await scorer();
  for (const options of [{ noop: true }, { revokeOnly: true }]) {
    const { session, key } = response(fixture('single-mint', 1), options);
    const scored = scoreResponse(session, key);
    assert.equal(scored.stages.attribution, true);
    assert.equal(scored.stages.provisional_containment, false);
    assert.equal(scored.stages.revocation_session_closure, false);
    assert.ok(scored.outcomes.unauthorized_exports > 0);
    assert.equal(scored.exact, false);
    assert.equal(scored.classification, 'model-fail');
  }
});

test('broad and avoidable quarantine fail recovery even if later released', async () => {
  const scoreResponse = await scorer();
  const broad = response(fixture('single-mint', 0), { broadQuarantine: true });
  const broadScore = scoreResponse(broad.session, broad.key);
  assert.equal(broadScore.stages.recovery, false);
  assert.ok(broadScore.outcomes.approved_only_quarantines.length > 0);
  assert.equal(broadScore.exact, false);
  const avoidable = response(fixture('mint-plus-session-only', 0), {
    quarantineSessionOnly: true,
  });
  const avoidableScore = scoreResponse(avoidable.session, avoidable.key);
  assert.equal(avoidableScore.stages.job_continuity, true);
  assert.equal(avoidableScore.stages.recovery, false);
  assert.ok(avoidableScore.outcomes.avoidable_session_only_quarantines.length > 0);
});

test('wrong standby, fixed wait, and early release fail the intended operational stage', async () => {
  const scoreResponse = await scorer();
  const source = fixture('both-live');
  const wrong = response(source, { wrongStandby: true });
  const wrongScore = scoreResponse(wrong.session, wrong.key);
  assert.equal(wrongScore.stages.job_continuity, false);
  assert.ok(wrongScore.outcomes.missed_jobs > 0);
  const waited = response(source, { fixedWait: true });
  const waitedScore = scoreResponse(waited.session, waited.key);
  assert.equal(waitedScore.stages.job_continuity, false);
  assert.ok(waitedScore.outcomes.missed_jobs > 0);
  const early = response(source, { earlyRelease: true });
  const earlyScore = scoreResponse(early.session, early.key);
  assert.equal(earlyScore.stages.recovery, false);
  assert.ok(earlyScore.outcomes.early_release_users.length > 0);
  assert.equal(earlyScore.stages.provisional_containment, false);
  assert.ok(earlyScore.outcomes.unauthorized_exports > 0);
});

test('approved-grant revocation fails preservation independently of cited attribution', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint'), { revokeApproved: true });
  const scored = scoreResponse(session, key);
  assert.equal(scored.stages.attribution, true);
  assert.equal(scored.stages.recovery, false);
  assert.ok(scored.outcomes.approved_revoked_grant_ids.length > 0);
  assert.equal(scored.exact, false);
});

test('accepted controls and assignments do not replace final live probes or delivery reads', async () => {
  const scoreResponse = await scorer();
  const source = fixture('both-live');
  const missingProbe = response(source, { omitFinalProbes: true });
  const missingProbeScore = scoreResponse(missingProbe.session, missingProbe.key);
  assert.equal(missingProbeScore.stages.provisional_containment, true);
  assert.equal(missingProbeScore.stages.job_continuity, true);
  assert.equal(missingProbeScore.stages.evidence_verification, false);
  assert.ok(missingProbeScore.evidence.missing_final_probe_grant_ids.length > 0);
  const stale = response(source, { staleProbe: true });
  const staleScore = scoreResponse(stale.session, stale.key);
  assert.equal(staleScore.stages.evidence_verification, false);
  assert.ok(staleScore.evidence.missing_final_probe_grant_ids.length > 0);
  const noRead = response(source, { omitDeliveryRead: true });
  const noReadScore = scoreResponse(noRead.session, noRead.key);
  assert.equal(noReadScore.stages.job_continuity, true);
  assert.equal(noReadScore.stages.evidence_verification, false);
  assert.ok(noReadScore.evidence.missing_delivery_read_job_ids.length > 0);
});

test('native effects cannot be hidden by editing engine outcome arrays after the action trace', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint', 1), { noop: true });
  session.protected_attempts = [];
  session.delivery_records = [];
  const scored = scoreResponse(session, key);
  assert.ok(scored.outcomes.unauthorized_exports > 0);
  assert.equal(scored.stages.provisional_containment, false);
});

test('a live token makes release premature even when it expires before the next export check', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('both-live'), {
    releaseAtTick2DespiteToken: true,
  });
  const scored = scoreResponse(session, key);
  assert.equal(scored.stages.provisional_containment, true);
  assert.equal(scored.stages.job_continuity, true);
  assert.equal(scored.stages.revocation_session_closure, true);
  assert.equal(scored.stages.recovery, false);
  assert.ok(scored.outcomes.early_release_users.length > 0);
  assert.equal(scored.outcomes.unauthorized_exports, 0);
});

test('a safe release without immediate post-release probes fails evidence verification', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint', 0), {
    omitPostReleaseProbes: true,
  });
  const scored = scoreResponse(session, key);
  assert.equal(scored.stages.provisional_containment, true);
  assert.equal(scored.stages.job_continuity, true);
  assert.equal(scored.stages.revocation_session_closure, true);
  assert.equal(scored.stages.evidence_verification, false);
  assert.ok(scored.evidence.missing_post_release_probe_users.length > 0);
});

test('structural correction and post-submit refusal do not become security misses', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint', 0), { rejectedCommand: true });
  assert.equal(
    stepResponse(session, { tool: 'probe', args: { grant_id: key.target_grant_ids[0] } }).ok,
    false,
  );
  const scored = scoreResponse(session, key);
  assert.equal(scored.exact, true);
  assert.equal(scored.classification, 'exact');
  assert.equal(scored.usage.tool_invocations, session.action_ledger.length);
});

test('evaluator expected-finding list cannot override independently derived source truth', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint', 0));
  key.expected_findings = [];
  const scored = scoreResponse(session, key);
  assert.equal(scored.exact, true);
  assert.equal(scored.attribution.expected_target_count, 1);
});

test('changing only a call-to-token edge changes native attribution rather than a parser class', async () => {
  const scoreResponse = await scorer();
  const source = fixture('single-mint', 0);
  const { episode, key } = source;
  const targetCall = episode.sources.events.find(
    (event) => event.event_id === key.expected_findings[0].call_event_id,
  );
  const approvedToken = episode.sources.events
    .filter((event) => event.kind === 'access-token-issued')
    .find((event) => {
      const grant = episode.sources.grants.find((item) => item.grant_id === event.grant_id);
      return (
        authorizedByJoin(grant, episode.sources.registry, grant.issue_time) &&
        event.source_time < targetCall.source_time &&
        event.arrival_index < targetCall.arrival_index
      );
    });
  assert.ok(approvedToken);
  targetCall.token_event_id = approvedToken.event_id;
  targetCall.caused_by_event_id = approvedToken.event_id;
  episode.hidden.revocation_lag_ticks = {};
  key.revocation_lag_ticks = {};
  assert.equal(
    validateResponseNative({ ...source.native, public: episode.sources, hidden: episode.hidden })
      .ok,
    true,
  );
  const session = createResponse(episode);
  for (let tick = 1; tick <= LIMITS.horizon_tick; tick++) {
    call(session, 'advance');
  }
  call(session, 'get_deliveries');
  call(session, 'submit', { findings: [] });
  const scored = scoreResponse(session, key);
  assert.equal(scored.attribution.expected_target_count, 0);
  assert.equal(scored.attribution.false_negatives, 0);
  assert.equal(scored.exact, true);

  const falseFindingSession = createResponse(episode);
  call(falseFindingSession, 'submit', { findings: key.expected_findings });
  const falseFindingScore = scoreResponse(falseFindingSession, key);
  assert.equal(falseFindingScore.attribution.no_call_false_positives, 1);
  assert.equal(falseFindingScore.classification, 'model-fail');
});

test('making one registry row valid at issuance removes an otherwise identical target', async () => {
  const scoreResponse = await scorer();
  const source = fixture('single-mint', 0);
  const { episode, key } = source;
  const targetId = key.target_grant_ids[0];
  const target = episode.sources.grants.find((grant) => grant.grant_id === targetId);
  const expiredExactRow = episode.sources.registry.find(
    (row) =>
      row.valid_until < target.issue_time &&
      authorizedByJoin(target, [{ ...row, valid_until: target.issue_time + 1 }], target.issue_time),
  );
  assert.ok(expiredExactRow);
  expiredExactRow.valid_until = target.issue_time + 1;
  episode.hidden.revocation_lag_ticks = {};
  key.revocation_lag_ticks = {};
  assert.equal(
    validateResponseNative({ ...source.native, public: episode.sources, hidden: episode.hidden })
      .ok,
    true,
  );
  const session = createResponse(episode);
  for (let tick = 1; tick <= LIMITS.horizon_tick; tick++) {
    call(session, 'advance');
  }
  call(session, 'get_deliveries');
  call(session, 'submit', { findings: [] });
  const scored = scoreResponse(session, key);
  assert.equal(scored.attribution.expected_target_count, 0);
  assert.equal(scored.stages.attribution, true);
  assert.equal(scored.exact, true);
});

test('a successful delivery read cannot be disguised as a rejected ledger action', async () => {
  const scoreResponse = await scorer();
  const { session, key } = response(fixture('single-mint', 0));
  const index = session.action_ledger.findIndex((entry) => entry.tool === 'get_deliveries');
  assert.ok(index >= 0);
  session.action_ledger[index] = { ...session.action_ledger[index], ok: false };
  assert.throws(() => scoreResponse(session, key), /ledger disagrees/);
});
