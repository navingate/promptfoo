import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';
import { auditShortcuts, planShortcut, SHORTCUT_NAMES, SHORTCUT_SEEDS } from './shortcut_audit.mjs';

test('shortcut audit is a fixed 12-seed by three-family reference and baseline screen', () => {
  const audit = auditShortcuts();
  assert.deepEqual(audit.seeds, SHORTCUT_SEEDS);
  assert.deepEqual(audit.families, FAMILIES);
  assert.equal(audit.total, 36);
  assert.deepEqual(Object.keys(audit.strategies), ['reference', ...SHORTCUT_NAMES]);
  assert.deepEqual(audit.strategies.reference.exact, { pass: 36, total: 36 });
  assert.deepEqual(audit.strategies.reference.triple, { pass: 12, total: 12 });
  for (const [name, result] of Object.entries(audit.strategies)) {
    assert.equal(result.by_seed.length, 12, name);
    assert.equal(
      result.by_seed.reduce((sum, batch) => sum + batch.passed, 0),
      result.exact.pass,
      name,
    );
    assert.equal(
      result.by_seed.filter((batch) => batch.passed === 3).length,
      result.triple.pass,
      name,
    );
    assert.ok(
      result.by_seed.every((batch) => batch.total === 3),
      name,
    );
    assert.equal(result.invalid_actions, 0, `${name} must reach the intended replay semantics`);
  }
});

test('every shortcut plans from visible evidence and fails at least one frozen case', () => {
  const sample = buildEpisode({ seed: SHORTCUT_SEEDS[0], family: FAMILIES[0], caseIndex: 3 });
  for (const name of SHORTCUT_NAMES) {
    const actions = planShortcut(name, structuredClone(sample.visible));
    assert.ok(Array.isArray(actions), name);
    assert.ok(
      actions.every((action) =>
        ['pause-job', 'deny-role-session', 'revoke-role-sessions'].includes(action.tool),
      ),
      name,
    );
    assert.equal(replayContainment(sample.native, actions).invalid_actions, 0, name);
  }
  const audit = auditShortcuts();
  for (const name of SHORTCUT_NAMES) {
    assert.ok(audit.strategies[name].exact.pass < 36, `${name} must not solve the full grid`);
  }
});

test('the first-listed shortcut follows visible queue order rather than a hidden label', () => {
  const episode = buildEpisode({ seed: SHORTCUT_SEEDS[1], family: FAMILIES[1], caseIndex: 3 });
  const visible = structuredClone(episode.visible);
  const releaseTokens = new Set(
    visible.events
      .filter((event) => event.kind === 'release-token-redeemed')
      .map((event) => event.event_id),
  );
  const releaseJobs = new Set(
    visible.events
      .filter(
        (event) => event.kind === 'job-submitted' && releaseTokens.has(event.auth_context_ref),
      )
      .map((event) => event.job_uid),
  );
  const selected = () =>
    planShortcut('first-listed-release', visible).find((action) => action.tool === 'pause-job')
      ?.args.job_uid;
  const first = visible.job_queue.find((job) => releaseJobs.has(job.job_uid));
  assert.equal(selected(), first.job_uid);
  visible.job_queue.reverse();
  const second = visible.job_queue.find((job) => releaseJobs.has(job.job_uid));
  assert.notEqual(first.job_uid, second.job_uid);
  assert.equal(selected(), second.job_uid);
});
