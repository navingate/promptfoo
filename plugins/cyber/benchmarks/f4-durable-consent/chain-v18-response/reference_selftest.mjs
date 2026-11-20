import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GRID, LIMITS } from './config.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { produceResponse } from './producer.mjs';
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
