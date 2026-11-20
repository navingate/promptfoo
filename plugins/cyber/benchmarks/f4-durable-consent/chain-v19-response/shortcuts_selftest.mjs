import assert from 'node:assert/strict';
import test from 'node:test';

import { computeRevokedGrantIds } from '../shared/estate.mjs';
import { GRID, LIMITS, TOOL_CONTRACT } from './config.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { produceResponse, validateResponseNative } from './producer.mjs';
import { runReference } from './reference.mjs';
import { scoreResponse } from './scorer.mjs';

async function shortcuts() {
  const module = await import('./shortcuts.mjs').catch(() => null);
  assert.ok(module?.screenAttributionShortcuts, 'shortcuts.mjs is missing');
  assert.ok(module?.runControlShortcut);
  assert.ok(module?.scanObservationPlane);
  return module;
}

function caseFor(profile, lagVariant = null) {
  const spec = GRID.find(
    (item) => item.profile === profile && (lagVariant === null || item.lag_variant === lagVariant),
  );
  assert.ok(spec);
  return produceResponse(spec);
}

test('grant, call, ID, order, expiry, due, and query shortcuts have named attribution misses', async () => {
  const { screenAttributionShortcuts } = await shortcuts();
  const rows = screenAttributionShortcuts(GRID.map((spec) => produceResponse(spec)));
  const expected = [
    'no_findings',
    'all_called',
    'grant_presence',
    'call_count_shape',
    'first_call',
    'last_call',
    'grant_id_prefix',
    'arrival_order',
    'short_token_expiry',
    'early_due_job',
    'skip_reset_query',
  ];
  assert.deepEqual(
    rows.map((row) => row.name),
    expected,
  );
  for (const row of rows) {
    assert.equal(row.total, 36);
    assert.ok(row.exact < row.total, `${row.name} solved all cases`);
    assert.ok(row.false_positive_grant_ids.length + row.false_negative_grant_ids.length > 0);
    assert.ok(row.positive_failures > 0 || row.benign_false_positive_cases > 0);
  }
  assert.ok(rows.find((row) => row.name === 'no_findings').false_negative_grant_ids.length > 0);
  assert.ok(
    rows.find((row) => row.name === 'all_called').survivor_false_positive_grant_ids.length > 0,
  );
  assert.ok(rows.find((row) => row.name === 'skip_reset_query').benign_false_positive_cases > 0);
  assert.ok(rows.find((row) => row.name === 'early_due_job').false_negative_grant_ids.length > 0);
});

test('control shortcuts fail for their named containment, continuity, recovery, or evidence reason', async () => {
  const { runControlShortcut } = await shortcuts();
  const positive = caseFor('both-live', 1);
  const benign = caseFor('benign');
  const noOp = runControlShortcut(positive, 'no_op');
  assert.equal(noOp.score.stages.attribution, true);
  assert.equal(noOp.score.stages.provisional_containment, false);
  assert.ok(noOp.score.outcomes.unauthorized_exports > 0);
  assert.ok(noOp.score.outcomes.live_unauthorized_path_ids.length > 0);

  for (const source of [positive, benign]) {
    const blocked = runControlShortcut(source, 'broad_block').score;
    assert.equal(blocked.stages.job_continuity, false);
    assert.equal(blocked.stages.recovery, false);
    assert.equal(blocked.outcomes.client_blocked, true);
    assert.ok(blocked.outcomes.missed_job_ids.length > 0);

    const blanket = runControlShortcut(source, 'blanket_quarantine').score;
    assert.equal(blanket.stages.recovery, false);
    assert.ok(blanket.outcomes.approved_only_quarantines.length > 0);
    assert.ok(blanket.outcomes.missed_job_ids.length > 0);
  }
  const revoked = runControlShortcut(positive, 'revoke_only').score;
  assert.equal(revoked.stages.revocation_session_closure, false);
  assert.ok(revoked.outcomes.live_unauthorized_path_ids.length > 0);

  const wait = runControlShortcut(positive, 'fixed_wait').score;
  assert.equal(wait.stages.job_continuity, false);
  assert.ok(wait.outcomes.missed_job_ids.length > 0);
  const wrongRunner = runControlShortcut(positive, 'wrong_runner').score;
  assert.equal(wrongRunner.stages.job_continuity, false);
  assert.ok(wrongRunner.outcomes.missed_job_ids.length > 0);
  const premature = runControlShortcut(positive, 'premature_release').score;
  assert.equal(premature.stages.provisional_containment, true);
  assert.equal(premature.stages.recovery, false);
  assert.ok(premature.evidence.early_release_users.length > 0);
  const prematureExport = runControlShortcut(positive, 'premature_release_export');
  assert.equal(prematureExport.score.stages.provisional_containment, false);
  assert.ok(prematureExport.score.outcomes.unauthorized_exports > 0);
  const releaseIndex = prematureExport.transcript.findIndex(
    (item) =>
      item.command.tool === 'set_quarantine' &&
      item.command.args.on === false &&
      item.result.tick === 1 &&
      prematureExport.score.evidence.early_release_users.includes(item.command.args.user_id),
  );
  assert.ok(releaseIndex > 0);
  const prior = prematureExport.transcript[releaseIndex - 1];
  assert.equal(prior.command.tool, 'probe_user');
  assert.equal(
    prior.command.args.user_id,
    prematureExport.transcript[releaseIndex].command.args.user_id,
  );
  assert.ok(prior.result.data.grants.every((row) => row.protected_access_allowed === false));
  const dashboard = runControlShortcut(positive, 'dashboard_only').score;
  assert.equal(dashboard.stages.provisional_containment, false);
  assert.ok(dashboard.outcomes.unauthorized_exports > 0);
});

test('identical lag twins defeat a fixed release user and fixed standby choice', async () => {
  const { runControlShortcut } = await shortcuts();
  for (const spec of GRID.filter((item) => item.profile === 'both-live')) {
    const plain = produceResponse(spec);
    const swapped = produceResponse({ ...spec, swap_lag: true });
    assert.deepEqual(plain.episode.initial, swapped.episode.initial);
    const fixed = runControlShortcut(swapped, 'fixed_release_from', plain);
    assert.equal(fixed.score.stages.provisional_containment, false);
    assert.ok(fixed.score.outcomes.unauthorized_exports > 0);
    const opposite = runControlShortcut(plain, 'fixed_release_from', swapped);
    assert.equal(opposite.score.stages.provisional_containment, false);
    assert.ok(opposite.score.outcomes.unauthorized_exports > 0);
    const fixedStandby = runControlShortcut(swapped, 'fixed_standby_from', plain);
    assert.equal(fixedStandby.score.stages.provisional_containment, true);
    assert.equal(fixedStandby.score.stages.job_continuity, false);
    assert.ok(fixedStandby.score.outcomes.missed_job_ids.length > 0);
    const oppositeStandby = runControlShortcut(plain, 'fixed_standby_from', swapped);
    assert.equal(oppositeStandby.score.stages.provisional_containment, true);
    assert.equal(oppositeStandby.score.stages.job_continuity, false);
    assert.ok(oppositeStandby.score.outcomes.missed_job_ids.length > 0);
  }
});

test('source-valid causal counterfactuals change the needed choice or named stage', async () => {
  const { runControlShortcut } = await shortcuts();
  const source = caseFor('single-mint', 0);
  const grant = source.episode.sources.grants.find(
    (item) => item.grant_id === source.key.target_grant_ids[0],
  );
  const row = source.episode.sources.registry.find((item) => {
    const candidate = { ...item, valid_until: grant.issue_time + 1 };
    return (
      item.valid_until < grant.issue_time &&
      candidate.client_or_app_selector === grant.client_id &&
      candidate.tenant_selector === grant.tenant &&
      candidate.principal_selector === grant.principal_binding
    );
  });
  assert.ok(row);
  row.valid_until = grant.issue_time + 1;
  source.episode.hidden.revocation_lag_ticks = {};
  source.key.revocation_lag_ticks = {};
  assert.equal(
    validateResponseNative({
      ...source.native,
      public: source.episode.sources,
      hidden: source.episode.hidden,
    }).ok,
    true,
  );
  const authorized = runReference(source.episode);
  assert.equal(authorized.transcript.at(-1).command.args.findings.length, 0);
  assert.equal(scoreResponse(authorized.session, source.key).exact, true);

  const original = caseFor('single-mint', 0);
  const lastBlock = runControlShortcut(original, 'late_block').score;
  assert.equal(lastBlock.stages.recovery, false);
  assert.equal(lastBlock.stages.evidence_verification, false);
  assert.equal(lastBlock.outcomes.client_blocked, true);
  assert.ok(lastBlock.evidence.missing_final_probe_grant_ids.length > 0);
});

test('call-to-token lineage and changed token or session liveness alter visible decisions', async () => {
  await shortcuts();
  const lineage = caseFor('single-mint', 0);
  const targetCall = lineage.episode.sources.events.find(
    (event) => event.event_id === lineage.key.expected_findings[0].call_event_id,
  );
  const approvedGrant = lineage.episode.sources.jobs[0].approved_grant_id;
  const approvedToken = lineage.episode.sources.events.find(
    (event) =>
      event.kind === 'access-token-issued' &&
      event.grant_id === approvedGrant &&
      event.source_time < targetCall.source_time,
  );
  assert.ok(approvedToken);
  targetCall.token_event_id = approvedToken.event_id;
  targetCall.caused_by_event_id = approvedToken.event_id;
  lineage.episode.hidden.revocation_lag_ticks = {};
  lineage.key.revocation_lag_ticks = {};
  assert.equal(
    validateResponseNative({
      ...lineage.native,
      public: lineage.episode.sources,
      hidden: lineage.episode.hidden,
    }).ok,
    true,
  );
  const noTarget = runReference(lineage.episode);
  assert.deepEqual(noTarget.transcript.at(-1).command.args.findings, []);
  assert.equal(scoreResponse(noTarget.session, lineage.key).exact, true);

  const tokenCase = caseFor('mint-plus-session-only', 1);
  const sessionOnlyId = tokenCase.key.session_only_grant_ids[0];
  const token = tokenCase.episode.sources.tokens.find((item) => item.grant_id === sessionOnlyId);
  token.expires_at_tick = 2;
  tokenCase.episode.sources.events.find(
    (event) => event.event_id === token.event_id,
  ).expires_at_tick = 2;
  const sessionOnlyUser = tokenCase.key.session_only_user_ids[0];
  const job = tokenCase.episode.sources.jobs.find(
    (item) => item.owner_user_id === sessionOnlyUser && item.due_tick === 1,
  );
  job.due_tick = 4;
  tokenCase.episode.sources.events.find(
    (event) => event.event_id === job.source_event_id,
  ).due_tick = 4;
  assert.equal(
    validateResponseNative({
      ...tokenCase.native,
      public: tokenCase.episode.sources,
      hidden: tokenCase.episode.hidden,
    }).ok,
    true,
  );
  const tokenResponse = runReference(tokenCase.episode);
  assert.equal(scoreResponse(tokenResponse.session, tokenCase.key).exact, true);
  assert.ok(
    tokenResponse.transcript.some(
      (item) =>
        item.command.tool === 'set_quarantine' &&
        item.command.args.user_id === sessionOnlyUser &&
        item.command.args.on === true,
    ),
  );
  assert.ok(
    tokenResponse.transcript.some(
      (item) =>
        item.command.tool === 'set_quarantine' &&
        item.command.args.user_id === sessionOnlyUser &&
        item.command.args.on === false &&
        item.result.tick === 2,
    ),
  );

  const sessionCase = caseFor('mint-plus-session-only', 1);
  const originalResource = sessionCase.episode.sources.sessions.find((item) =>
    sessionCase.episode.sources.tokens.some(
      (part) =>
        part.token_id === item.token_id &&
        part.grant_id === sessionCase.key.session_only_grant_ids[0],
    ),
  );
  originalResource.expires_at_tick = 0;
  sessionCase.episode.sources.events.find(
    (event) => event.event_id === originalResource.event_id,
  ).expires_at_tick = 0;
  assert.equal(
    validateResponseNative({
      ...sessionCase.native,
      public: sessionCase.episode.sources,
      hidden: sessionCase.episode.hidden,
    }).ok,
    true,
  );
  const sessionResponse = runReference(sessionCase.episode);
  assert.equal(scoreResponse(sessionResponse.session, sessionCase.key).exact, true);
  assert.equal(
    sessionResponse.transcript.some(
      (item) =>
        item.command.tool === 'terminate_session' &&
        item.command.args.session_id === originalResource.session_id,
    ),
    false,
  );
});

test('changing the queried enumeration facet removes a genuine reset miss', async () => {
  await shortcuts();
  const source = caseFor('single-mint', 0);
  const { episode, key } = source;
  const target = episode.sources.grants.find((grant) => grant.grant_id === key.target_grant_ids[0]);
  const reset = episode.sources.resets.find(
    (item) => item.compromised_user === target.principal_binding,
  );
  assert.equal(reset.revoked_grant_ids.includes(target.grant_id), false);
  target.enumeration_facet = reset.defect_enumerated;
  target.revoked_at_tick = 0;
  reset.revoked_grant_ids = computeRevokedGrantIds(
    episode.sources.grants,
    episode.sources.registry,
    reset,
  );
  assert.ok(reset.revoked_grant_ids.includes(target.grant_id));
  episode.sources.events.find(
    (event) => event.event_id === reset.reset_event_id,
  ).revoked_grant_ids = [...reset.revoked_grant_ids];
  // The queried grant is revoked at reset, so its fresh post-reset token,
  // protected call, and child session cannot occur in the counterfactual.
  const token = episode.sources.tokens.find((item) => item.grant_id === target.grant_id);
  const targetCall = episode.sources.events.find(
    (event) => event.kind === 'protected-export-call' && event.token_event_id === token.event_id,
  );
  const resource = episode.sources.sessions.find((item) => item.token_id === token.token_id);
  episode.sources.tokens = episode.sources.tokens.filter(
    (item) => item.token_id !== token.token_id,
  );
  episode.sources.sessions = episode.sources.sessions.filter(
    (item) => item.session_id !== resource.session_id,
  );
  const removedEventIds = new Set([token.event_id, targetCall.event_id, resource.event_id]);
  episode.sources.events = episode.sources.events
    .filter((event) => !removedEventIds.has(event.event_id))
    .map((event, arrival_index) => ({ ...event, arrival_index }));
  const approvedGrantId = episode.sources.jobs[0].approved_grant_id;
  const approvedToken = episode.sources.events.find(
    (event) => event.kind === 'access-token-issued' && event.grant_id === approvedGrantId,
  );
  const approvedCall = episode.sources.events.find(
    (event) =>
      event.kind === 'protected-export-call' && event.token_event_id === approvedToken.event_id,
  );
  episode.initial.alert = {
    call_event_id: approvedCall.event_id,
    client_id: approvedCall.client_id,
    source_time: approvedCall.source_time,
    arrival_index: approvedCall.arrival_index,
  };
  assert.equal(
    episode.sources.events.some((event) => event.token_event_id === token.event_id),
    false,
  );
  episode.hidden.revocation_lag_ticks = {};
  key.revocation_lag_ticks = {};
  const validity = validateResponseNative({
    ...source.native,
    public: episode.sources,
    hidden: episode.hidden,
  });
  assert.equal(validity.ok, true, validity.reason);
  assert.equal(validity.target_grant_ids.length, 0);
  const response = runReference(episode);
  assert.deepEqual(response.transcript.at(-1).command.args.findings, []);
  const scored = scoreResponse(response.session, key);
  assert.equal(scored.attribution.expected_target_count, 0);
  assert.equal(scored.exact, true);
});

test('moving a quarantined job deadline to tick one changes assignment time', async () => {
  await shortcuts();
  const source = produceResponse(GRID.find((spec) => spec.seed === 42037));
  const job = source.episode.sources.jobs.find((item) => item.due_tick === 2);
  job.due_tick = 1;
  source.episode.sources.events.find((event) => event.event_id === job.source_event_id).due_tick =
    1;
  assert.equal(
    validateResponseNative({
      ...source.native,
      public: source.episode.sources,
      hidden: source.episode.hidden,
    }).ok,
    true,
  );
  const result = runReference(source.episode);
  assert.equal(scoreResponse(result.session, source.key).exact, true);
  const assignment = result.transcript.find(
    (item) => item.command.tool === 'assign_job' && item.command.args.job_id === job.job_id,
  );
  assert.equal(assignment.result.tick, 0);
});

test('signed runner eligibility and capacity reject the wrong standby plan', async () => {
  await shortcuts();
  const source = produceResponse(GRID.find((spec) => spec.seed === 42037));
  const session = createResponse(source.episode);
  const due = source.episode.sources.jobs.filter((job) => job.due_tick === 2);
  const standby = source.episode.sources.runners.find((runner) => runner.standby);
  assert.equal(
    stepResponse(session, {
      tool: 'assign_job',
      args: { job_id: due[0].job_id, runner_id: standby.runner_id },
    }).ok,
    true,
  );
  assert.equal(
    stepResponse(session, {
      tool: 'assign_job',
      args: { job_id: due[1].job_id, runner_id: standby.runner_id },
    }).error.code,
    'runner_capacity_exceeded',
  );
  assert.equal(
    stepResponse(session, {
      tool: 'assign_job',
      args: { job_id: due[1].job_id, runner_id: due[0].current_runner_id },
    }).error.code,
    'runner_not_authorized',
  );

  const sessionOnly = caseFor('mint-plus-session-only', 1);
  const noStandby = sessionOnly.episode.sources.jobs.find(
    (job) => job.owner_user_id === sessionOnly.key.session_only_user_ids[0] && job.due_tick === 1,
  );
  const noStandbySession = createResponse(sessionOnly.episode);
  const shared = sessionOnly.episode.sources.runners.find((runner) => runner.standby);
  assert.equal(
    stepResponse(noStandbySession, {
      tool: 'assign_job',
      args: { job_id: noStandby.job_id, runner_id: shared.runner_id },
    }).error.code,
    'runner_not_authorized',
  );
  const exact = runReference(sessionOnly.episode);
  assert.equal(scoreResponse(exact.session, sessionOnly.key).exact, true);
  assert.equal(
    exact.transcript.some(
      (item) =>
        item.command.tool === 'set_quarantine' &&
        item.command.args.user_id === noStandby.owner_user_id,
    ),
    false,
  );
});

test('aggregate probe adds no pre-tick-one lag signal; all visible traces omit evaluator labels', async () => {
  const { scanObservationPlane } = await shortcuts();
  const specs = [
    ...GRID,
    ...GRID.filter((spec) => spec.profile === 'both-live').map((spec) => ({
      ...spec,
      swap_lag: true,
    })),
  ];
  for (const spec of specs) {
    const { episode, key } = produceResponse(spec);
    const result = runReference(episode);
    assert.deepEqual(scanObservationPlane(result, TOOL_CONTRACT), []);
    assert.equal(result.turns <= LIMITS.reference_turns, true);
    assert.equal(scoreResponse(result.session, key).exact, true);
  }
  for (const spec of GRID.filter((item) => item.profile === 'both-live')) {
    const first = produceResponse(spec).episode;
    const twin = produceResponse({ ...spec, swap_lag: true }).episode;
    const probesBeforeOne = (episode) => {
      const session = createResponse(episode);
      const principals = stepResponse(session, { tool: 'list_client_principals', args: {} }).data
        .principals;
      return principals.map((principal) => {
        const userId = principal.user_id;
        const owned = stepResponse(session, {
          tool: 'get_user_grants',
          args: { user_id: userId },
        }).data;
        const probe = stepResponse(session, { tool: 'probe_user', args: { user_id: userId } }).data;
        assert.deepEqual(
          probe.grants.map((row) => row.grant_id),
          owned.map((grant) => grant.grant_id),
        );
        return probe;
      });
    };
    assert.deepEqual(probesBeforeOne(first), probesBeforeOne(twin));
  }
  const result = runReference(caseFor('both-live').episode);
  assert.deepEqual(
    scanObservationPlane(result, TOOL_CONTRACT, {
      prompt: { target_grant_ids: [] },
      files: [],
      environment: {},
      artifacts: [],
    }),
    ['target_grant_ids'],
  );
});
