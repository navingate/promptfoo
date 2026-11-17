import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createContinuity,
  executePlan,
  produceContinuity,
  referenceContinuity,
  scoreContinuity,
  stepContinuity,
} from './continuity.mjs';

const profiles = ['both-live', 'session-only', 'single-user', 'benign-survivor'];

test('producer varies exposed paths while keeping labels out of source facts', () => {
  const expectedCounts = [2, 2, 1, 0];
  const approvalCounts = [];
  for (const [index, profile] of profiles.entries()) {
    const { episode, key } = produceContinuity({ seed: 85017, profile });
    assert.equal(key.expected_target_ids.length, expectedCounts[index]);
    assert.equal(episode.jobs.length, 3);
    assert.equal(episode.runners.length, 4);
    assert.equal(episode.run_authorizations.length >= 4, true);
    assert.equal(JSON.stringify(episode).includes('expected_target_ids'), false);
    assert.equal(JSON.stringify(episode).includes('safe_runner'), false);
    assert.equal(new Set(episode.jobs.map((job) => job.job_id)).size, 3);
    approvalCounts.push(episode.approvals.length);
  }
  assert.equal(new Set(approvalCounts).size, 1, 'approval-row count must not reveal benign outcome');
});

test('source-visible reference contains and preserves each profile across seeds', () => {
  for (const profile of profiles) {
    for (const seed of [85017, 85018, 85029, 85030, 85041, 85042]) {
      const { episode, key } = produceContinuity({ seed, profile });
      const { session, plan } = referenceContinuity(episode);
      const score = scoreContinuity(session, key);
      assert.equal(score.exact, true, `${profile}/${seed}: ${JSON.stringify(score)}`);
      assert.equal(score.deliveries.length, 3);
      assert.equal(score.deliveries.every((delivery) => delivery.delivered), true);
      assert.equal(plan.at(-1).tool, 'submit');
    }
  }
});

test('seed changes which job needs the flexible standby, not just identifier order', () => {
  for (const [seed, expectedRegionCount] of [[85017, 1], [85018, 2]]) {
    const { episode } = produceContinuity({ seed, profile: 'both-live' });
    const { plan } = referenceContinuity(episode);
    const alertJob = episode.jobs.find((job) => job.owner_user_id === episode.alert.user_id);
    const assignment = plan.find((command) => command.tool === 'assign_job' && command.args.job_id === alertJob.job_id);
    const runner = episode.runners.find((item) => item.runner_id === assignment.args.runner_id);
    assert.equal(runner.allowed_regions.length, expectedRegionCount);
  }
});

test('quarantine without job migration prevents attacker export but misses due jobs', () => {
  const { episode, key } = produceContinuity({ seed: 85017, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const session = executePlan(episode, plan.filter((command) => command.tool !== 'assign_job'));
  const score = scoreContinuity(session, key);
  assert.equal(score.unauthorized_calls.length, 0);
  assert.equal(score.exact, false);
  assert.equal(score.deliveries.some((delivery) => !delivery.delivered), true);
});

test('shared standby capacity and stale data prevent apparently plausible assignments', () => {
  const { episode, key } = produceContinuity({ seed: 85017, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const backupForBoth = episode.runners.find(
    (runner) => episode.jobs.filter((job) => episode.run_authorizations.some(
      (auth) => auth.job_id === job.job_id && auth.runner_id === runner.runner_id,
    )).length >= 2 && runner.allowed_regions.includes('US'),
  );
  assert.ok(backupForBoth);
  const collision = executePlan(
    episode,
    plan.map((command) =>
      command.tool === 'assign_job'
        ? { ...command, args: { ...command.args, runner_id: backupForBoth.runner_id } }
        : command,
    ),
  );
  assert.equal(scoreContinuity(collision, key).exact, false);
  assert.equal(scoreContinuity(collision, key).deliveries.some((item) => item.reason === 'capacity'), true);

  const stale = episode.runners.find((runner) => runner.data_cursor < 70);
  assert.ok(stale);
  const changed = plan.map((command) =>
    command.tool === 'assign_job' && episode.jobs.find((job) => job.job_id === command.args.job_id)?.region === 'US'
      ? { ...command, args: { ...command.args, runner_id: stale.runner_id } }
      : command,
  );
  const staleScore = scoreContinuity(executePlan(episode, changed), key);
  assert.equal(staleScore.exact, false);
  assert.equal(staleScore.deliveries.some((item) => item.reason === 'stale-data'), true);
});

test('a capable runner without signed job authorization misses delivery', () => {
  const { episode, key } = produceContinuity({ seed: 85017, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const alertJob = episode.jobs.find((job) => job.owner_user_id === episode.alert.user_id);
  const unauthorizedRunner = episode.runners.find(
    (runner) =>
      runner.tenant_id === alertJob.tenant_id &&
      runner.allowed_regions.includes(alertJob.region) &&
      runner.data_cursor >= alertJob.required_data_cursor &&
      !episode.run_authorizations.some(
        (auth) => auth.job_id === alertJob.job_id && auth.runner_id === runner.runner_id,
      ),
  );
  assert.ok(unauthorizedRunner);
  const changed = plan.map((command) =>
    command.tool === 'assign_job' && command.args.job_id === alertJob.job_id
      ? { ...command, args: { ...command.args, runner_id: unauthorizedRunner.runner_id } }
      : command,
  );
  const score = scoreContinuity(executePlan(episode, changed), key);
  assert.equal(score.exact, false);
  assert.equal(score.deliveries.some((item) => item.reason === 'missing-authorization'), true);
});

test('releasing quarantine before token expiry permits a new unauthorized export', () => {
  const { episode, key } = produceContinuity({ seed: 85017, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const beforeFirstAdvance = plan.findIndex((command) => command.tool === 'advance');
  const changed = [...plan];
  changed.splice(beforeFirstAdvance, 0, {
    tool: 'set_quarantine',
    args: { user_id: episode.alert.user_id, on: false },
  });
  const score = scoreContinuity(executePlan(episode, changed), key);
  assert.equal(score.exact, false);
  assert.equal(score.unauthorized_calls.length > 0, true);
});

test('already-revoked session-only path needs termination but no quarantine', () => {
  const { episode, key } = produceContinuity({ seed: 85029, profile: 'session-only' });
  const sessionOnlyGrant = episode.grants.find(
    (grant) => key.expected_target_ids.includes(grant.grant_id) && grant.revoked_at !== null,
  );
  assert.ok(sessionOnlyGrant);
  const { plan } = referenceContinuity(episode);
  assert.equal(
    plan.some((command) =>
      command.tool === 'set_quarantine' && command.args.user_id === sessionOnlyGrant.user_id,
    ),
    false,
  );
  assert.equal(
    plan.some((command) => command.tool === 'terminate_session'),
    true,
  );
});

test('wrong approval action and benign overreaction fail separately', () => {
  const produced = produceContinuity({ seed: 85017, profile: 'both-live' });
  const { plan } = referenceContinuity(produced.episode);
  const wrong = executePlan(produced.episode, [
    { tool: 'revoke_grant', args: { grant_id: produced.key.approved_ids[0] } },
    ...plan,
  ]);
  const wrongScore = scoreContinuity(wrong, produced.key);
  assert.equal(wrongScore.exact, false);
  assert.equal(wrongScore.approved_grants_revoked.length, 1);

  const benign = produceContinuity({ seed: 85017, profile: 'benign-survivor' });
  const session = createContinuity(benign.episode);
  assert.equal(stepContinuity(session, {
    tool: 'set_quarantine',
    args: { user_id: benign.episode.alert.user_id, on: true },
  }).ok, true);
  assert.equal(stepContinuity(session, { tool: 'submit', args: {} }).ok, true);
  const score = scoreContinuity(session, benign.key);
  assert.equal(score.exact, false);
  assert.equal(score.unnecessary_quarantines.includes(benign.episode.alert.user_id), true);
});

test('no action and client-wide block cannot pass a malicious incident', () => {
  const { episode, key } = produceContinuity({ seed: 85017, profile: 'both-live' });
  for (const plan of [
    [{ tool: 'submit', args: {} }],
    [{ tool: 'block_client', args: {} }, { tool: 'submit', args: {} }],
  ]) {
    const score = scoreContinuity(executePlan(episode, plan), key);
    assert.equal(score.exact, false);
  }
});
