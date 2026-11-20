import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GRID, LIMITS } from './config.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { produceResponse, validateResponseNative } from './producer.mjs';
import { scoreResponse } from './scorer.mjs';

async function reference() {
  const module = await import('./reference.mjs').catch(() => null);
  assert.ok(module?.runReference, 'visible-only reference.mjs is missing');
  return module.runReference;
}

function specimens() {
  return [
    ...GRID,
    ...GRID.filter((spec) => spec.profile === 'both-live').map((spec) => ({
      ...spec,
      swap_lag: true,
    })),
  ];
}

test('visible-only reference scores exact on all 36 cases and 12 lag twins within 40 calls', async () => {
  const runReference = await reference();
  for (const spec of specimens()) {
    const { episode, key } = produceResponse(spec);
    const result = runReference(episode);
    const score = scoreResponse(result.session, key);
    assert.equal(
      score.exact,
      true,
      `${spec.seed}/${spec.swap_lag ?? false}: ${JSON.stringify(score)}`,
    );
    assert.ok(result.turns <= LIMITS.reference_turns, `${spec.seed}: ${result.turns} turns`);
    assert.ok(
      result.actions <= LIMITS.reference_actions,
      `${spec.seed}: ${result.actions} actions`,
    );
    assert.equal(result.turns, result.transcript.length);
    assert.equal(result.actions, result.transcript.length);
    assert.equal(result.actions, result.session.action_count);
    assert.equal(result.transcript.at(-1).command.tool, 'submit');
    assert.equal(
      result.transcript.every((item) => item.result.ok),
      true,
    );

    const trace = result.transcript;
    const principals = episode.sources.principals.map((item) => item.user_id);
    for (const tool of ['get_user_grants', 'get_activity', 'get_reset']) {
      assert.deepEqual(
        trace.filter((item) => item.command.tool === tool).map((item) => item.command.args.user_id),
        principals,
        `${spec.seed}: ${tool} must cover every principal`,
      );
    }
    for (const tool of [
      'list_client_principals',
      'get_registry',
      'get_jobs',
      'get_runners',
      'get_runner_authorizations',
    ]) {
      assert.equal(trace.filter((item) => item.command.tool === tool).length, 1);
    }
    assert.deepEqual(
      trace
        .filter((item) => item.command.tool === 'get_deliveries')
        .map((item) => item.result.tick),
      [1, 2, 4],
    );
    for (const release of trace.filter(
      (item) => item.command.tool === 'set_quarantine' && item.command.args.on === false,
    )) {
      const prior = trace.findLast(
        (item) =>
          item.index < release.index &&
          item.result.tick === release.result.tick &&
          item.command.tool === 'probe_user' &&
          item.command.args.user_id === release.command.args.user_id,
      );
      const next = trace.find(
        (item) =>
          item.index > release.index &&
          item.result.tick === release.result.tick &&
          item.command.tool === 'probe_user' &&
          item.command.args.user_id === release.command.args.user_id,
      );
      assert.ok(prior && next, `${spec.seed}: release needs same-tick before/after probes`);
    }
    if (spec.profile === 'both-live') {
      const targetIds = new Set(key.target_grant_ids);
      assert.equal(trace.filter((item) => item.command.tool === 'get_dashboard').length, 1);
      const dashboard = trace.find((item) => item.command.tool === 'get_dashboard');
      assert.equal(dashboard.result.tick, 1);
      const slowProbe = trace.find(
        (item) =>
          item.index > dashboard.index &&
          item.command.tool === 'probe_user' &&
          item.result.tick === 1 &&
          item.result.data.grants.some((row) => targetIds.has(row.grant_id) && row.can_mint),
      );
      assert.ok(slowProbe, `${spec.seed}: live probe must expose delayed revocation`);
      const slowGrant = slowProbe.result.data.grants.find(
        (row) => targetIds.has(row.grant_id) && row.can_mint,
      );
      assert.ok(
        dashboard.result.data.some(
          (row) =>
            row.grant_id === slowGrant.grant_id &&
            row.effective === true &&
            row.observation_tick === 1,
        ),
        `${spec.seed}: derived dashboard and live authorization must conflict`,
      );
      const tickTwo = trace.find(
        (item) =>
          item.command.tool === 'probe_user' &&
          item.command.args.user_id === slowProbe.command.args.user_id &&
          item.result.tick === 2,
      );
      assert.ok(
        tickTwo?.result.data.grants.some(
          (row) => targetIds.has(row.grant_id) && row.live_token_ids.length > 0,
        ),
      );
      const tickThree = trace.find(
        (item) =>
          item.command.tool === 'probe_user' &&
          item.command.args.user_id === slowProbe.command.args.user_id &&
          item.result.tick === 3,
      );
      assert.ok(
        tickThree?.result.data.grants.every((row) => !targetIds.has(row.grant_id) || !row.can_mint),
      );
    }
  }
});

test('reference cannot inspect episode or session internals after creation', async () => {
  const runReference = await reference();
  const { episode, key } = produceResponse(GRID.find((spec) => spec.profile === 'both-live'));
  let created = false;
  let rawSession;
  const guardedEpisode = new Proxy(episode, {
    get(target, property) {
      assert.equal(created, false, `episode.${String(property)} read after creation`);
      return target[property];
    },
  });
  const result = runReference(guardedEpisode, {
    create(candidate) {
      rawSession = createResponse(candidate);
      created = true;
      return new Proxy(rawSession, {
        get(target, property) {
          assert.equal(property, 'initial', `session.${String(property)} read by reference`);
          return target[property];
        },
      });
    },
    step(_session, command) {
      return stepResponse(rawSession, command);
    },
  });
  assert.equal(created, true);
  assert.equal(scoreResponse(rawSession, key).exact, true);
  assert.ok(result.turns <= 40);
  const source = await readFile(new URL('./reference.mjs', import.meta.url), 'utf8');
  assert.equal(
    /\.\s*(?:sources|hidden|key|action_ledger|now_tick|job_assignments)\b/.test(source),
    false,
  );
});

test('lag twins have the same pre-tick-one observation and force different feedback decisions', async () => {
  const runReference = await reference();
  for (const spec of GRID.filter((item) => item.profile === 'both-live')) {
    const plain = runReference(produceResponse(spec).episode);
    const swapped = runReference(produceResponse({ ...spec, swap_lag: true }).episode);
    const beforeOne = (result) =>
      result.transcript
        .filter((item) => item.result.tick === 0)
        .map((item) => [item.command, item.result]);
    assert.deepEqual(beforeOne(plain), beforeOne(swapped));
    const releasedAtOne = (result) =>
      result.transcript
        .filter(
          (item) =>
            item.result.tick === 1 &&
            item.command.tool === 'set_quarantine' &&
            item.command.args.on === false,
        )
        .map((item) => item.command.args.user_id);
    assert.equal(releasedAtOne(plain).length, 1);
    assert.equal(releasedAtOne(swapped).length, 1);
    assert.notDeepEqual(releasedAtOne(plain), releasedAtOne(swapped));
  }
});

test('reference matches signed standby capacity when two quarantined jobs share a due tick', async () => {
  const runReference = await reference();
  const source = produceResponse(GRID.find((spec) => spec.seed === 42037));
  const { episode, key, native } = source;
  const facts = episode.sources;
  const due = facts.jobs.filter((job) => job.due_tick === 2);
  const firstTarget = facts.grants.find(
    (grant) =>
      grant.principal_binding === due[0].owner_user_id &&
      key.target_grant_ids.includes(grant.grant_id),
  );
  assert.equal(key.revocation_lag_ticks[firstTarget.grant_id], 1);
  const token = facts.tokens.find((item) => item.grant_id === firstTarget.grant_id);
  token.expires_at_tick = 3;
  facts.events.find((event) => event.event_id === token.event_id).expires_at_tick = 3;

  const shared = facts.runners.find((runner) => runner.standby);
  const extraRunnerId = 'runner_extra_counterfactual';
  const extraRunnerEventId = 'evt_extra_runner_counterfactual';
  facts.runners.push({ ...shared, runner_id: extraRunnerId, source_event_id: extraRunnerEventId });
  const runnerEvent = facts.events.find((event) => event.event_id === shared.source_event_id);
  facts.events.push({
    ...runnerEvent,
    event_id: extraRunnerEventId,
    runner_id: extraRunnerId,
    arrival_index: facts.events.length,
    arrival_time: 2000,
  });
  const signed = facts.runner_authorizations.find(
    (row) => row.job_id === due[0].job_id && row.runner_id === shared.runner_id,
  );
  const extraAuthorizationId = 'auth_extra_counterfactual';
  const extraAuthorizationEventId = 'evt_extra_auth_counterfactual';
  facts.runner_authorizations.push({
    ...signed,
    authorization_id: extraAuthorizationId,
    runner_id: extraRunnerId,
    signature: 'sig_extra_counterfactual',
    source_event_id: extraAuthorizationEventId,
  });
  const authorizationEvent = facts.events.find(
    (event) => event.event_id === signed.source_event_id,
  );
  facts.events.push({
    ...authorizationEvent,
    event_id: extraAuthorizationEventId,
    authorization_id: extraAuthorizationId,
    runner_id: extraRunnerId,
    signature: 'sig_extra_counterfactual',
    arrival_index: facts.events.length,
    arrival_time: 2001,
  });
  assert.equal(validateResponseNative({ ...native, public: facts }).ok, true);

  const result = runReference(episode);
  const assignments = result.transcript
    .filter((item) => item.command.tool === 'assign_job')
    .map((item) => item.command.args);
  assert.deepEqual(assignments, [
    { job_id: due[0].job_id, runner_id: extraRunnerId },
    { job_id: due[1].job_id, runner_id: shared.runner_id },
  ]);
  assert.equal(scoreResponse(result.session, key).exact, true);
});
