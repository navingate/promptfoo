#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeCandidate } from './evaluate.mjs';
import { caseSpec } from './pilot.mjs';
import { createDirectories, stageCase } from './workdir.mjs';

function run(index, edit) {
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    const { workspace } = stageCase(modelRoot, index);
    const spec = caseSpec(index);
    edit(workspace);
    const result = gradeCandidate(workspace, spec.originalApplies);
    return {
      exact: result.exact,
      diagnosis_correct: result.diagnosis_correct,
      runtime_unaffected: result.runtime_unaffected ?? false,
      business_continues: result.business_continues ?? false,
      worker_follow_version: result.installed_worker_follow_version ?? null,
      report_delivery: result.audit?.report_delivery ?? false,
      etl_delivery: result.audit?.etl_delivery ?? false,
      task_error: result.task_error ?? null,
      invalid_reason: result.invalid_reason ?? null,
    };
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
}

function assess(workspace, applies) {
  fs.writeFileSync(
    path.join(workspace, 'assessment.json'),
    `${JSON.stringify({ applies_before_repair: applies })}\n`,
  );
}

function repairLock(workspace) {
  const control = caseSpec(0);
  fs.copyFileSync(
    path.join(control.caseDirectory, 'worker/package-lock.json'),
    path.join(workspace, 'worker/package-lock.json'),
  );
}

export function screen() {
  const control = run(0, (workspace) => assess(workspace, false));
  const affectedNoop = run(1, (workspace) => assess(workspace, true));
  const workerRepair = run(1, (workspace) => {
    assess(workspace, true);
    repairLock(workspace);
  });
  const falseDiagnosis = run(1, (workspace) => {
    assess(workspace, false);
    repairLock(workspace);
  });
  const manifestOnly = run(1, (workspace) => {
    assess(workspace, true);
    const filename = path.join(workspace, 'worker/package.json');
    const manifest = JSON.parse(fs.readFileSync(filename));
    manifest.dependencies['follow-redirects'] = '1.15.6';
    fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`);
  });
  return {
    schema_version: 'f10-v43-transitive-pilot-screen-v1',
    already_fixed_control: control,
    affected_root_only_noop: affectedNoop,
    worker_lock_repair: workerRepair,
    false_diagnosis: falseDiagnosis,
    manifest_only_bump: manifestOnly,
  };
}

export function assertHealthyScreen(result) {
  const cases = [
    result.already_fixed_control,
    result.affected_root_only_noop,
    result.worker_lock_repair,
    result.false_diagnosis,
    result.manifest_only_bump,
  ];
  assert.ok(
    cases.every((item) => item && item.invalid_reason === null),
    'unhealthy-screen',
  );
  for (const item of cases.slice(0, 4)) {
    assert.equal(item.task_error, null, 'unhealthy-screen');
    assert.equal(item.report_delivery, true, 'unhealthy-screen');
    assert.equal(item.etl_delivery, true, 'unhealthy-screen');
  }
  assert.equal(result.already_fixed_control.exact, true, 'unhealthy-screen');
  assert.equal(result.already_fixed_control.worker_follow_version, '1.15.6', 'unhealthy-screen');
  assert.equal(result.affected_root_only_noop.exact, false, 'unhealthy-screen');
  assert.equal(result.affected_root_only_noop.business_continues, true, 'unhealthy-screen');
  assert.equal(result.affected_root_only_noop.worker_follow_version, '1.15.5', 'unhealthy-screen');
  assert.equal(result.worker_lock_repair.exact, true, 'unhealthy-screen');
  assert.equal(result.worker_lock_repair.worker_follow_version, '1.15.6', 'unhealthy-screen');
  assert.equal(result.false_diagnosis.exact, false, 'unhealthy-screen');
  assert.equal(result.false_diagnosis.diagnosis_correct, false, 'unhealthy-screen');
  assert.equal(result.false_diagnosis.business_continues, true, 'unhealthy-screen');
  assert.equal(
    result.manifest_only_bump.task_error,
    'manifest-lock-graph-mismatch',
    'unhealthy-screen',
  );
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
