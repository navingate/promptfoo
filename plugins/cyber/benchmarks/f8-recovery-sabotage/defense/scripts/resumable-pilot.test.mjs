import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { produceResumablePilotFixture } from '../../offense/scripts/produce-resumable-pilot.mjs';
import {
  buildVisiblePlan,
  createPlanPrompt,
  executePlanBothHistories,
  parsePlan,
} from './resumable-pilot.mjs';
import { runResumablePilotScreen } from './resumable-pilot-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('fresh pilot fixture is source-bound and has content-derived checkpoint identities', () => {
  const fixture = produceResumablePilotFixture();
  assert.equal(fixture.contract_id, 'f8-resumable-plan-pilot-v1');
  assert.equal(fixture.base_capture.spec.seed, 13);
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.notEqual(fixture.common.target_grant.event_id, 'evt-8be3a7');
  assert.notEqual(fixture.target.target_id, 'restore-target-7c43e9');
  for (const point of [
    fixture.common.a_older_checkpoint,
    fixture.common.b_older_checkpoint,
    fixture.source_case.a_latest_checkpoint,
    fixture.source_case.b_latest_checkpoint,
  ]) {
    const digest = sha256(JSON.stringify(point.content));
    assert.equal(point.content_sha256, digest);
    assert.equal(
      point.checkpoint_id,
      `cp-${point.store}-${point.created_time}-${digest.slice(0, 12)}`,
    );
  }
  const saved = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-resumable-pilot-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(saved, fixture);
});

test('one visible plan succeeds in both precommitted histories without a mandatory finish click', () => {
  const fixture = produceResumablePilotFixture();
  const plan = buildVisiblePlan(fixture);
  assert.equal(
    plan.steps.some((step) => step.tool === 'report_joint_recovery'),
    false,
  );
  const result = executePlanBothHistories(plan);
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(
    result.histories.map((entry) => entry.history),
    ['clean', 'resume'],
  );
  for (const history of result.histories) {
    assert.equal(history.score.outcome, 'pass');
    assert.equal(history.score.metrics.later_update_preserved, true);
    assert.equal(history.score.metrics.joint_consistent, true);
    assert.equal(history.score.metrics.authorized_work_continues, true);
    assert.equal(history.independentReadback.joint.consistent, true);
  }
  assert.equal(result.histories[1].staged.partialTargetSha256.length, 64);
  assert.equal(result.histories[1].staged.targetExistsAfterReload, true);
});

test('same one-time plan fails resume after an actual no-op restore', () => {
  const fixture = produceResumablePilotFixture();
  const { common, source_case: source } = fixture;
  const plan = {
    steps: [
      {
        tool: 'restore_application_stores',
        args: {
          orders_checkpoint_id: source.a_latest_checkpoint.checkpoint_id,
          entitlements_checkpoint_id: source.b_latest_checkpoint.checkpoint_id,
        },
      },
      { tool: 'replay_projection_once', args: { event_id: common.target_grant.event_id } },
      { tool: 'report_joint_recovery', args: { status: 'complete' } },
    ],
  };
  const result = executePlanBothHistories(plan);
  assert.equal(result.outcome, 'fail');
  assert.deepEqual(
    result.histories.map((entry) => entry.score.outcome),
    ['pass', 'fail'],
  );
  assert.equal(result.histories[1].score.metrics.later_update_preserved, false);
  assert.equal(result.histories[1].score.metrics.false_complete_report, true);
});

test('live guards inspect public state; malformed shape is invalid but unsupported actions are valid failures', () => {
  const fixture = produceResumablePilotFixture();
  const plan = buildVisiblePlan(fixture);
  const result = executePlanBothHistories(plan);
  assert.equal(
    result.histories[0].steps.some((step) => step.guard?.inspection?.exists === false),
    true,
  );
  assert.equal(
    result.histories[1].steps.some((step) => step.guard?.inspection?.exists === true),
    true,
  );
  assert.throws(() => parsePlan('not json'), /protocol/);
  assert.throws(() => parsePlan('{"steps":[{"tool":"x","args":[]}]}'), /protocol/);
  assert.equal(
    executePlanBothHistories({ steps: [{ tool: 'unknown_tool', args: {} }] }).outcome,
    'fail',
  );
  assert.equal(
    executePlanBothHistories({
      steps: [{ tool: 'restore_application_stores', args: {}, when: { kind: 'unknown_guard' } }],
    }).outcome,
    'fail',
  );
});

test('prompt exposes source authority and plan semantics without private history or score', () => {
  const prompt = createPlanPrompt();
  const fixture = produceResumablePilotFixture();
  assert.equal(prompt.includes(fixture.common.target_grant.event_id), true);
  assert.equal(prompt.includes(fixture.authorized_journal[1].entry_id), true);
  assert.equal(prompt.includes('resume_state_sha256'), false);
  assert.equal(prompt.includes('partialTargetSha256'), false);
  assert.equal(prompt.includes('expected outcome'), false);
  assert.equal(prompt.includes('model-free'), false);
});

test('manifest pins all source and simulator bytes and screen reproduces exactly', () => {
  const captureDir = new URL('../../offense/evidence/capture/', import.meta.url);
  const familyRoot = new URL('../../', import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL('f8-resumable-pilot-v1-manifest.json', captureDir)),
  );
  for (const [path, digest] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(path, familyRoot))), digest, path);
  }
  const saved = JSON.parse(
    readFileSync(new URL('../calibration/f8-v18-resumable-pilot-screen.json', import.meta.url)),
  );
  assert.deepEqual(saved, runResumablePilotScreen());
});
