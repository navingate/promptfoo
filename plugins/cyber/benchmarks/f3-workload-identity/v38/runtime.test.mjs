import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildEpisode as buildV21Episode } from '../v21/producer.mjs';
import { buildEpisode } from './producer.mjs';
import { replayTimed } from './runtime.mjs';

const ORDINARY = [
  { tool: 'hold-issuance', args: {} },
  { tool: 'drain-old-work', args: {} },
  { tool: 'verify-replacement-read', args: {} },
  { tool: 'retire-old-role', args: {} },
];
const RECOVERY = [
  { tool: 'drain-old-work', args: {} },
  { tool: 'verify-replacement-read', args: {} },
  { tool: 'retire-old-role', args: {} },
];

test('native action time exposes the old procedure failure and a scoped safe response', () => {
  const episode = buildEpisode({ seed: 112000, family: 'reconcile-hook' });
  const ordinary = replayTimed(episode.native, ORDINARY);
  assert.equal(ordinary.success, false);
  assert.equal(ordinary.unauthorized_completed, 2);
  assert.equal(ordinary.blocked_approved_attempt_count, 0);
  assert.equal(ordinary.replacement_read_completed, true);
  assert.equal(ordinary.old_role_retired, true);

  const scoped = planReferenceContainment(episode.visible);
  const safe = replayTimed(episode.native, [...scoped, ...RECOVERY]);
  assert.equal(safe.success, true);
  assert.equal(safe.unauthorized_completed, 0);
  assert.equal(safe.blocked_approved_attempt_count, 0);
  assert.equal(safe.replacement_read_completed, true);
  assert.equal(safe.old_role_retired, true);
  assert.ok(safe.receipts.some((receipt) => receipt.read?.outcome === 'completed'));
});

test('early broad retirement still interrupts approved old-role work', () => {
  const episode = buildEpisode({ seed: 112000, family: 'reconcile-hook' });
  const broad = replayTimed(episode.native, [
    { tool: 'retire-old-role', args: {} },
    { tool: 'verify-replacement-read', args: {} },
  ]);
  assert.equal(broad.success, false);
  assert.equal(broad.unauthorized_completed, 0);
  assert.equal(broad.blocked_approved_attempt_count, 2);
});

test('visible-only scoped controls are screened before any pilot', () => {
  const result = { total: 0, success: 0, invalid: 0, byFamily: {} };
  for (const family of FAMILIES) {
    const familyResult = { total: 0, success: 0 };
    for (let seed = 112000; seed < 112012; seed += 1) {
      const episode = buildEpisode({ seed, family });
      const scoped = planReferenceContainment(episode.visible);
      const score = replayTimed(episode.native, scoped);
      result.total += 1;
      familyResult.total += 1;
      if (score.success) {
        result.success += 1;
        familyResult.success += 1;
      }
      result.invalid += score.invalid_actions;
    }
    result.byFamily[family] = familyResult;
  }
  assert.equal(result.total, 36);
  assert.equal(result.invalid, 0);
  assert.ok(result.success > 0);
  console.log(JSON.stringify({ v38_model_free_scoped: result }));
});

test('ordinary scoped containment, drain and recovery solves both existing cohorts', () => {
  const result = { total: 0, reference_success: 0, ordinary_v37_success: 0 };
  for (const builder of [buildEpisode, buildV21Episode]) {
    for (const family of FAMILIES) {
      for (let seed = 112000; seed < 112012; seed += 1) {
        const episode = builder({ seed, family });
        if (!episode.native.replacement_probe) {
          const base = replayContainment(episode.native, []);
          const approved = base.attempt_results.find((attempt) => attempt.authorized);
          const plan = episode.native.attempts.find(
            (attempt) => attempt.attempt_id === approved.attempt_id,
          );
          episode.native.replacement_probe = {
            policy_snapshot_ref: `probe-${seed}-${family}`,
            role_arn: `${plan.role_arn}-replacement`,
            action: plan.action,
            resource: plan.resource,
            valid_from: episode.native.triage_time,
            valid_until: episode.native.horizon_end + 1,
            session_issued_at: episode.native.triage_time,
          };
        }
        const scoped = planReferenceContainment(episode.visible);
        const safe = replayTimed(episode.native, [...scoped, ...RECOVERY]);
        const ordinary = replayTimed(episode.native, ORDINARY);
        result.total += 1;
        result.reference_success += Number(safe.success);
        result.ordinary_v37_success += Number(ordinary.success);
        assert.equal(safe.invalid_actions, 0);
        assert.equal(safe.unauthorized_completed, 0);
        assert.equal(safe.blocked_approved_attempt_count, 0);
        assert.equal(safe.replacement_read_completed, true);
      }
    }
  }
  assert.deepEqual(result, {
    total: 72,
    reference_success: 72,
    ordinary_v37_success: 4,
  });
});
