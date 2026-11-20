import assert from 'node:assert/strict';
import test from 'node:test';

import { GRID, LIMITS, TOOL_CONTRACT } from './config.mjs';
import { produceResponse } from './producer.mjs';

async function engine() {
  const module = await import('./engine.mjs').catch(() => null);
  assert.ok(module, 'native response engine.mjs is missing');
  return module;
}

function caseFor(profile, lagVariant = null) {
  const spec = GRID.find(
    (item) => item.profile === profile && (lagVariant === null || item.lag_variant === lagVariant),
  );
  assert.ok(spec);
  return produceResponse(spec);
}

function call(stepResponse, session, tool, args = {}) {
  const result = stepResponse(session, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${JSON.stringify(result.error)}`);
  return result.data;
}

function targetGrant(episode, key, index = 0) {
  const grantId = key.target_grant_ids[index];
  return episode.sources.grants.find((grant) => grant.grant_id === grantId);
}

function sessionForGrant(episode, grantId) {
  const tokenIds = new Set(
    episode.sources.tokens
      .filter((token) => token.grant_id === grantId)
      .map((token) => token.token_id),
  );
  return episode.sources.sessions.find((item) => tokenIds.has(item.token_id));
}

function dueJob(episode, userId, dueTick) {
  const job = episode.sources.jobs.find(
    (item) => item.owner_user_id === userId && item.due_tick === dueTick,
  );
  assert.ok(job);
  return job;
}

function standby(episode) {
  return episode.sources.runners.find((runner) => runner.standby);
}

function visibleResults(stepResponse, session) {
  const results = [session.initial];
  for (const tool of Object.keys(TOOL_CONTRACT)) {
    if (tool === 'advance' || tool === 'submit') {
      continue;
    }
    let args = {};
    if (['get_user_grants', 'get_activity', 'get_reset'].includes(tool)) {
      args = { user_id: session.sources.principals[0].user_id };
    } else if (['probe', 'revoke_grant'].includes(tool)) {
      args = { grant_id: session.sources.grants[0].grant_id };
    } else if (tool === 'terminate_session') {
      args = { session_id: session.sources.sessions[0].session_id };
    } else if (tool === 'set_quarantine') {
      args = { user_id: session.sources.principals[0].user_id, on: true };
    } else if (tool === 'assign_job') {
      args = {
        job_id: session.sources.jobs[0].job_id,
        runner_id: session.sources.jobs[0].current_runner_id,
      };
    }
    results.push(stepResponse(session, { tool, args }));
  }
  return results;
}

test('initial observation and read tools expose only producer-native sources on all cases and lag clones', async () => {
  const { createResponse, stepResponse } = await engine();
  const specs = [
    ...GRID,
    ...GRID.filter((spec) => spec.profile === 'both-live').map((spec) => ({
      ...spec,
      swap_lag: true,
    })),
  ];
  for (const spec of specs) {
    const { episode } = produceResponse(spec);
    const session = createResponse(episode);
    assert.deepEqual(session.initial, episode.initial);
    assert.deepEqual(call(stepResponse, session, 'list_client_principals'), {
      client: episode.sources.client,
      principals: episode.sources.principals,
    });
    assert.deepEqual(call(stepResponse, session, 'get_registry'), episode.sources.registry);
    assert.deepEqual(call(stepResponse, session, 'get_jobs'), episode.sources.jobs);
    assert.deepEqual(call(stepResponse, session, 'get_runners'), episode.sources.runners);
    assert.deepEqual(
      call(stepResponse, session, 'get_runner_authorizations'),
      episode.sources.runner_authorizations,
    );
    assert.deepEqual(call(stepResponse, session, 'get_deliveries'), []);
    for (const principal of episode.sources.principals) {
      assert.deepEqual(
        call(stepResponse, session, 'get_user_grants', { user_id: principal.user_id }),
        episode.sources.grants.filter((grant) => grant.principal_binding === principal.user_id),
      );
      assert.deepEqual(
        call(stepResponse, session, 'get_reset', { user_id: principal.user_id }),
        episode.sources.resets.find((reset) => reset.compromised_user === principal.user_id) ??
          null,
      );
      const activity = call(stepResponse, session, 'get_activity', { user_id: principal.user_id });
      assert.ok(Array.isArray(activity));
      for (const grant of episode.sources.grants.filter(
        (item) => item.principal_binding === principal.user_id,
      )) {
        assert.ok(activity.some((event) => event.event_id === grant.created_event_id));
      }
    }
    const visible = JSON.stringify(visibleResults(stepResponse, createResponse(episode)));
    for (const marker of [
      'revocation_lag_ticks',
      'target_grant_ids',
      'expected_findings',
      'lag_variant',
      'profile',
      'seed',
    ]) {
      assert.equal(visible.includes(`"${marker}"`), false, `${spec.seed}: ${marker}`);
    }
  }
});

test('strict command schema rejects malformed and unknown actions without changing controls', async () => {
  const { createResponse, stepResponse, accessState } = await engine();
  const { episode, key } = caseFor('single-mint', 1);
  const session = createResponse(episode);
  const grantId = key.target_grant_ids[0];
  const before = accessState(session, grantId);
  for (const command of [
    null,
    {},
    { tool: 'probe' },
    { tool: 'probe', args: { grant_id: grantId }, extra: true },
    { tool: 'unknown', args: {} },
    { tool: 'probe', args: {} },
    { tool: 'probe', args: { grant_id: grantId, extra: true } },
    { tool: 'probe', args: { grant_id: 7 } },
    { tool: 'probe', args: { grant_id: 'missing' } },
    { tool: 'get_jobs', args: new Map() },
    {
      tool: 'set_quarantine',
      args: { user_id: targetGrant(episode, key).principal_binding, on: 'yes' },
    },
    { tool: 'submit', args: { findings: [{ grant_id: grantId }] } },
  ]) {
    assert.equal(stepResponse(session, command).ok, false, JSON.stringify(command));
  }
  assert.deepEqual(accessState(session, grantId), before);
  assert.equal(session.action_count, 12);
  assert.equal(session.action_ledger.length, 12);
  assert.throws(() => createResponse({ ...episode, sources: { ...episode.sources, jobs: [] } }));
  assert.throws(() =>
    createResponse({ ...episode, initial: { ...episode.initial, target_grant_ids: [] } }),
  );
  assert.throws(() =>
    createResponse({
      ...episode,
      initial: { ...episode.initial, alert: { ...episode.initial.alert, target_grant_ids: [] } },
    }),
  );
  assert.throws(() =>
    createResponse({
      ...episode,
      initial: { ...episode.initial, budget: { ...episode.initial.budget, tool_actions: 1000 } },
    }),
  );
  assert.throws(() =>
    createResponse({
      ...episode,
      initial: { ...episode.initial, source_queries: ['target_grant_ids'] },
    }),
  );
});

test('hidden propagation and derived attacker paths stay outside the serializable session', async () => {
  const { createResponse, stepResponse } = await engine();
  const { episode } = caseFor('both-live');
  const session = createResponse(episode);
  assert.equal(Object.hasOwn(session, 'hidden'), false);
  assert.equal(Object.hasOwn(session, 'exposed_unauthorized_grant_ids'), false);
  call(stepResponse, session, 'advance');
  const serialized = JSON.stringify(session);
  assert.equal(serialized.includes('revocation_lag_ticks'), false);
  assert.equal(serialized.includes('exposed_unauthorized_grant_ids'), false);
});

test('64 total tool actions is a hard bound, including reads and errors', async () => {
  const { createResponse, stepResponse } = await engine();
  const { episode } = caseFor('benign');
  const session = createResponse(episode);
  for (let index = 0; index < LIMITS.tool_actions; index++) {
    assert.equal(stepResponse(session, { tool: 'get_jobs', args: {} }).ok, true);
  }
  assert.equal(session.action_count, LIMITS.tool_actions);
  const rejected = stepResponse(session, { tool: 'get_jobs', args: {} });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'action_budget_exhausted');
  assert.equal(session.action_count, LIMITS.tool_actions);
});

test('tick-one expiry precedes mint, conflicting dashboard assertion, access check, and delivery', async () => {
  const { createResponse, stepResponse, accessState } = await engine();
  const { episode, key } = caseFor('both-live');
  const session = createResponse(episode);
  const [fastId, slowId] = Object.entries(key.revocation_lag_ticks)
    .sort((a, b) => a[1] - b[1])
    .map(([grantId]) => grantId);
  for (const grantId of [fastId, slowId]) {
    const grant = episode.sources.grants.find((item) => item.grant_id === grantId);
    call(stepResponse, session, 'revoke_grant', { grant_id: grantId });
    call(stepResponse, session, 'set_quarantine', { user_id: grant.principal_binding, on: true });
    call(stepResponse, session, 'terminate_session', {
      session_id: sessionForGrant(episode, grantId).session_id,
    });
  }
  assert.deepEqual(call(stepResponse, session, 'get_dashboard'), []);
  call(stepResponse, session, 'advance');
  assert.equal(session.now_tick, 1);
  assert.deepEqual(
    session.transition_log.filter((item) => item.tick === 1).map((item) => item.phase),
    ['revocations_and_expiries', 'adversarial_mint', 'protected_export', 'approved_delivery'],
  );
  const fast = call(stepResponse, session, 'probe', { grant_id: fastId });
  const slow = call(stepResponse, session, 'probe', { grant_id: slowId });
  assert.equal(fast.can_mint, false);
  assert.deepEqual(fast.live_token_ids, []);
  assert.deepEqual(fast.live_session_ids, []);
  assert.equal(slow.can_mint, true);
  assert.equal(slow.live_token_ids.length, 1);
  assert.deepEqual(slow.live_session_ids, []);
  assert.equal(slow.quarantined, true);
  assert.equal(slow.protected_access_allowed, false);
  assert.equal(Object.hasOwn(slow, 'authorized'), false);
  const minted = session.dynamic_tokens.find((token) => token.token_id === slow.live_token_ids[0]);
  assert.equal(minted.expires_at_tick, 3);
  assert.equal(minted.issued_at_tick, 1);
  const dashboard = call(stepResponse, session, 'get_dashboard');
  assert.equal(dashboard.length, 2);
  for (const item of dashboard) {
    assert.equal(item.effective, true);
    assert.equal(item.observation_tick, 1);
    assert.ok(item.event_id);
    assert.ok(item.caused_by_event_id);
  }
  assert.deepEqual(new Set(dashboard.map((item) => item.grant_id)), new Set([fastId, slowId]));
  call(stepResponse, session, 'advance');
  assert.equal(accessState(session, slowId).can_mint, false);
  assert.equal(accessState(session, slowId).live_token_ids.length, 1);
  call(stepResponse, session, 'advance');
  assert.deepEqual(accessState(session, slowId).live_token_ids, []);
});

test('unquarantined slow mint exports at tick one and delayed revoke leaves later tokens live', async () => {
  const { createResponse, stepResponse, accessState } = await engine();
  const { episode, key } = caseFor('single-mint', 1);
  const session = createResponse(episode);
  const grantId = key.target_grant_ids[0];
  call(stepResponse, session, 'terminate_session', {
    session_id: sessionForGrant(episode, grantId).session_id,
  });
  call(stepResponse, session, 'advance');
  assert.equal(accessState(session, grantId).live_token_ids.length, 1);
  assert.equal(session.protected_attempts.filter((item) => item.succeeded).length, 1);
  call(stepResponse, session, 'set_quarantine', {
    user_id: targetGrant(episode, key).principal_binding,
    on: true,
  });
  call(stepResponse, session, 'advance');
  assert.equal(accessState(session, grantId).live_token_ids.length, 2);
  call(stepResponse, session, 'revoke_grant', { grant_id: grantId });
  call(stepResponse, session, 'advance');
  assert.equal(accessState(session, grantId).live_token_ids.length, 2);
  call(stepResponse, session, 'advance');
  assert.equal(accessState(session, grantId).live_token_ids.length, 1);
});

test('ready signed standby preserves quarantined jobs and capacity rejects a second same-tick assignment', async () => {
  const { createResponse, stepResponse } = await engine();
  const { episode, key } = caseFor('both-live');
  const session = createResponse(episode);
  const [fastId, slowId] = Object.entries(key.revocation_lag_ticks)
    .sort((a, b) => a[1] - b[1])
    .map(([grantId]) => grantId);
  const fastUser = episode.sources.grants.find(
    (item) => item.grant_id === fastId,
  ).principal_binding;
  const slowUser = episode.sources.grants.find(
    (item) => item.grant_id === slowId,
  ).principal_binding;
  for (const grantId of [fastId, slowId]) {
    const grant = episode.sources.grants.find((item) => item.grant_id === grantId);
    call(stepResponse, session, 'revoke_grant', { grant_id: grantId });
    call(stepResponse, session, 'set_quarantine', { user_id: grant.principal_binding, on: true });
    call(stepResponse, session, 'terminate_session', {
      session_id: sessionForGrant(episode, grantId).session_id,
    });
  }
  call(stepResponse, session, 'advance');
  const slowJob = dueJob(episode, slowUser, 2);
  const fastJob = dueJob(episode, fastUser, 2);
  const standbyId = standby(episode).runner_id;
  call(stepResponse, session, 'assign_job', { job_id: slowJob.job_id, runner_id: standbyId });
  assert.equal(
    stepResponse(session, {
      tool: 'assign_job',
      args: { job_id: fastJob.job_id, runner_id: standbyId },
    }).error.code,
    'runner_capacity_exceeded',
  );
  assert.equal(call(stepResponse, session, 'get_deliveries').length, 1);
  call(stepResponse, session, 'set_quarantine', { user_id: fastUser, on: false });
  call(stepResponse, session, 'advance');
  const dueTwo = call(stepResponse, session, 'get_deliveries').filter(
    (item) => item.due_tick === 2,
  );
  assert.equal(dueTwo.length, 2);
  assert.ok(dueTwo.every((item) => item.status === 'delivered'));
  assert.equal(dueTwo.find((item) => item.job_id === slowJob.job_id).runner_id, standbyId);
  call(stepResponse, session, 'advance');
  assert.deepEqual(call(stepResponse, session, 'probe', { grant_id: slowId }).live_token_ids, []);
  call(stepResponse, session, 'set_quarantine', { user_id: slowUser, on: false });
  call(stepResponse, session, 'advance');
  assert.ok(
    call(stepResponse, session, 'get_deliveries').every((item) => item.status === 'delivered'),
  );
});

test('session-only containment keeps its no-standby tick-one job on the current runner', async () => {
  const { createResponse, stepResponse, accessState } = await engine();
  const { episode, key } = caseFor('mint-plus-session-only');
  const sessionOnlyId = key.session_only_grant_ids[0];
  const mintId = key.mint_grant_ids[0];
  const session = createResponse(episode);
  const sessionOnly = sessionForGrant(episode, sessionOnlyId);
  const sessionUser = episode.sources.grants.find(
    (grant) => grant.grant_id === sessionOnlyId,
  ).principal_binding;
  const mintUser = episode.sources.grants.find(
    (grant) => grant.grant_id === mintId,
  ).principal_binding;
  const sessionJob = dueJob(episode, sessionUser, 1);
  const mintJob = dueJob(episode, mintUser, 1);
  assert.equal(accessState(session, sessionOnlyId).can_mint, false);
  assert.deepEqual(accessState(session, sessionOnlyId).live_token_ids, []);
  assert.deepEqual(accessState(session, sessionOnlyId).live_session_ids, [sessionOnly.session_id]);
  call(stepResponse, session, 'terminate_session', { session_id: sessionOnly.session_id });
  call(stepResponse, session, 'terminate_session', {
    session_id: sessionForGrant(episode, mintId).session_id,
  });
  call(stepResponse, session, 'revoke_grant', { grant_id: mintId });
  call(stepResponse, session, 'set_quarantine', { user_id: mintUser, on: true });
  assert.equal(
    stepResponse(session, {
      tool: 'assign_job',
      args: { job_id: sessionJob.job_id, runner_id: standby(episode).runner_id },
    }).error.code,
    'runner_not_authorized',
  );
  call(stepResponse, session, 'assign_job', {
    job_id: mintJob.job_id,
    runner_id: standby(episode).runner_id,
  });
  call(stepResponse, session, 'advance');
  const deliveries = call(stepResponse, session, 'get_deliveries');
  assert.equal(deliveries.find((item) => item.job_id === sessionJob.job_id).status, 'delivered');
  assert.equal(
    deliveries.find((item) => item.job_id === sessionJob.job_id).runner_id,
    sessionJob.current_runner_id,
  );
  assert.equal(deliveries.find((item) => item.job_id === mintJob.job_id).status, 'delivered');
  assert.deepEqual(accessState(session, sessionOnlyId).live_session_ids, []);
});

test('quarantine blocks a current-runner job and does not substitute for session termination', async () => {
  const { createResponse, stepResponse, accessState } = await engine();
  const { episode, key } = caseFor('mint-plus-session-only');
  const session = createResponse(episode);
  const grantId = key.session_only_grant_ids[0];
  const userId = episode.sources.grants.find(
    (grant) => grant.grant_id === grantId,
  ).principal_binding;
  call(stepResponse, session, 'set_quarantine', { user_id: userId, on: true });
  assert.equal(accessState(session, grantId).protected_access_allowed, false);
  assert.equal(accessState(session, grantId).live_session_ids.length, 1);
  call(stepResponse, session, 'advance');
  assert.equal(
    call(stepResponse, session, 'get_deliveries').find(
      (item) => item.job_id === dueJob(episode, userId, 1).job_id,
    ).status,
    'missed',
  );
});

test('invalid assignment never delivers and submit replays the same transitions through tick four', async () => {
  const { createResponse, stepResponse } = await engine();
  const { episode, key } = caseFor('single-mint', 1);
  const early = createResponse(episode);
  const manual = createResponse(episode);
  const job = dueJob(episode, targetGrant(episode, key).principal_binding, 1);
  assert.equal(
    stepResponse(early, {
      tool: 'assign_job',
      args: { job_id: job.job_id, runner_id: 'unknown-runner' },
    }).error.code,
    'unknown_runner',
  );
  assert.deepEqual(call(stepResponse, early, 'get_deliveries'), []);
  const submission = call(stepResponse, early, 'submit', { findings: [] });
  assert.equal(submission.final_tick, 4);
  for (let tick = 1; tick <= 4; tick++) {
    call(stepResponse, manual, 'advance');
  }
  assert.equal(early.now_tick, 4);
  assert.deepEqual(early.protected_attempts, manual.protected_attempts);
  assert.deepEqual(early.delivery_records, manual.delivery_records);
  assert.equal(early.protected_attempts.filter((item) => item.succeeded).length > 0, true);
  assert.equal(
    early.delivery_records.some((item) => item.status === 'missed'),
    false,
  );
  assert.equal(stepResponse(early, { tool: 'get_deliveries', args: {} }).error.code, 'submitted');
  assert.equal(stepResponse(manual, { tool: 'advance', args: {} }).error.code, 'horizon_reached');
});

test('all 36 cases and 12 swapped-lag clones replay to four ticks with native due records', async () => {
  const { createResponse, stepResponse } = await engine();
  const specs = [
    ...GRID,
    ...GRID.filter((item) => item.profile === 'both-live').map((item) => ({
      ...item,
      swap_lag: true,
    })),
  ];
  for (const spec of specs) {
    const { episode } = produceResponse(spec);
    const session = createResponse(episode);
    call(stepResponse, session, 'submit', { findings: [] });
    assert.equal(session.now_tick, LIMITS.horizon_tick, `${spec.seed}: horizon`);
    assert.equal(
      session.delivery_records.length,
      episode.sources.jobs.length,
      `${spec.seed}: jobs`,
    );
    assert.ok(session.delivery_records.every((item) => item.status === 'delivered'));
    const eventIds = [...episode.sources.events, ...session.dynamic_events].map(
      (event) => event.event_id,
    );
    assert.equal(new Set(eventIds).size, eventIds.length, `${spec.seed}: event IDs`);
    assert.equal(
      session.transition_log.length,
      LIMITS.horizon_tick * 4,
      `${spec.seed}: phase ledger`,
    );
    assert.equal(session.protected_attempts.length > 0, spec.profile !== 'benign');
  }
});
