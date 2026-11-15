import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';
import { auditShortcuts, planShortcut, SHORTCUT_NAMES, SHORTCUT_SEEDS } from './shortcut_audit.mjs';

test('v19 shortcut screen reports 36 episodes and 12 exact three-family batches', () => {
  assert.ok(SHORTCUT_NAMES.includes('earliest-completed-fetch'));
  const audit = auditShortcuts();
  assert.deepEqual(audit.seeds, SHORTCUT_SEEDS);
  assert.deepEqual(audit.families, FAMILIES);
  assert.equal(audit.total, 36);
  assert.deepEqual(Object.keys(audit.strategies), ['reference', ...SHORTCUT_NAMES]);
  assert.deepEqual(audit.strategies.reference.exact, { pass: 36, total: 36 });
  assert.deepEqual(audit.strategies.reference.triple, { pass: 12, total: 12 });
  for (const [name, result] of Object.entries(audit.strategies)) {
    assert.equal(result.by_seed.length, 12, name);
    assert.equal(result.exact.total, 36, name);
    assert.equal(result.triple.total, 12, name);
    assert.equal(result.invalid_actions, 0, name);
    assert.equal(
      Object.values(result.failure_causes).reduce((sum, count) => sum + count, 0),
      36 - result.exact.pass,
      name,
    );
    assert.equal(
      result.by_seed.filter((batch) => batch.passed === 3).length,
      result.triple.pass,
      name,
    );
  }
});

test('visible-only shortcut planners emit valid actions and any-two follows queue order', () => {
  const episode = buildEpisode({ seed: SHORTCUT_SEEDS[0], family: FAMILIES[0] });
  const visible = structuredClone(episode.visible);
  const tokenIds = new Set(
    visible.events
      .filter((event) => event.kind === 'release-token-redeemed')
      .map((event) => event.event_id),
  );
  const releases = new Set(
    visible.events
      .filter((event) => event.kind === 'job-submitted' && tokenIds.has(event.auth_context_ref))
      .map((event) => event.job_uid),
  );
  assert.equal(releases.size, 3);
  for (const name of SHORTCUT_NAMES) {
    const actions = planShortcut(name, visible);
    assert.ok(Array.isArray(actions), name);
    assert.ok(
      actions.every((action) =>
        ['pause-job', 'deny-role-session', 'revoke-role-sessions'].includes(action.tool),
      ),
      name,
    );
    assert.equal(replayContainment(episode.native, actions).invalid_actions, 0, name);
  }
  const selected = () =>
    planShortcut('any-two-release', visible)
      .filter((action) => action.tool === 'pause-job')
      .map((action) => action.args.job_uid)
      .sort();
  const firstTwo = visible.job_queue
    .filter((job) => releases.has(job.job_uid))
    .slice(0, 2)
    .map((job) => job.job_uid)
    .sort();
  assert.deepEqual(selected(), firstTwo);
  visible.job_queue.reverse();
  assert.notDeepEqual(selected(), firstTwo);
});

test('event-ID prefix baseline loses its old source clue after visible ID remapping', () => {
  const { visible } = buildEpisode({ seed: SHORTCUT_SEEDS[1], family: FAMILIES[1] });
  assert.ok(visible.events.every((event) => /^evt-[a-f0-9]{24}$/u.test(event.event_id)));
  assert.deepEqual(
    planShortcut('native-event-id-prefix', visible),
    planShortcut('job-only', visible),
  );
});

test('simple fetch choices fail in both source error directions across the frozen grid', () => {
  for (const name of [
    'revision-two-source',
    'latest-completed-fetch',
    'earliest-completed-fetch',
  ]) {
    let missedTaintedRead = 0;
    let blockedCleanReleaseRead = 0;
    for (const seed of SHORTCUT_SEEDS) {
      for (const family of FAMILIES) {
        const episode = buildEpisode({ seed, family });
        const actions = planShortcut(name, episode.visible);
        const score = replayContainment(episode.native, actions);
        assert.equal(score.invalid_actions, 0, name);
        const scoredCollateral = new Set(score.blocked_clean_attempts);
        missedTaintedRead += score.attempt_results.filter(
          (attempt) =>
            attempt.completed && attempt.source_approved === false && attempt.job_approved === true,
        ).length;
        blockedCleanReleaseRead += score.attempt_results.filter(
          (attempt) =>
            scoredCollateral.has(attempt.attempt_id) &&
            attempt.source_approved === true &&
            attempt.job_approved === true,
        ).length;
      }
    }
    assert.ok(missedTaintedRead > 0, `${name} needs a source-bad false negative`);
    assert.ok(blockedCleanReleaseRead > 0, `${name} needs a clean-source false positive`);
  }
});
