#!/usr/bin/env node
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
    schema_version: 'f10-v43-transitive-pilot-screen-draft-v1',
    already_fixed_control: control,
    affected_root_only_noop: affectedNoop,
    worker_lock_repair: workerRepair,
    false_diagnosis: falseDiagnosis,
    manifest_only_bump: manifestOnly,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
