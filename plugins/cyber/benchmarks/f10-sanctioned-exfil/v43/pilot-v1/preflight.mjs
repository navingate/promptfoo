import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeCandidate } from './evaluate.mjs';
import { CASE_ORDER, caseSpec, sha256 } from './pilot.mjs';
import {
  assertPrivateDirectory,
  createDirectories,
  inspect,
  probeBoundary,
  probePublicCheck,
  stageCase,
} from './workdir.mjs';

const directory = import.meta.dirname;
const repositoryRoot = path.resolve(directory, '../../../../../../../..');
const sessionHistory =
  '/Users/navnn/.codex/sessions/2026/02/07/rollout-2026-02-07T06-13-17-019c35df-fd91-7e02-8d37-86533f585868.jsonl.zst';

export function preflight(index, keep = false) {
  const spec = caseSpec(index);
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    const staged = stageCase(modelRoot, index);
    assertPrivateDirectory(modelRoot, '/private/tmp/f10v43-model-');
    assertPrivateDirectory(rawDirectory, '/private/tmp/f10v43-raw-');
    const rawSentinel = path.join(rawDirectory, 'private-sentinel.txt');
    fs.writeFileSync(rawSentinel, 'private', { mode: 0o600, flag: 'wx' });
    const sibling = CASE_ORDER[(index + 1) % CASE_ORDER.length];
    const deniedPaths = [
      path.resolve(directory, '../../v42/evidence/manifest.json'),
      path.resolve(directory, '../../v42/cases', sibling, 'workspace/worker/package-lock.json'),
      path.join(directory, 'evaluate.mjs'),
      rawSentinel,
      '/Users/navnn/.codex/config.toml',
      sessionHistory,
    ];
    const deniedFiles = deniedPaths.map((file) => ({
      path: file,
      sha256: sha256(fs.readFileSync(file)),
    }));
    const boundary = probeBoundary(modelRoot, repositoryRoot, deniedFiles);
    const publicCheck = probePublicCheck(modelRoot, repositoryRoot);
    const inspected = inspect(modelRoot, staged.hashes);
    assert.equal(inspected.sound, true, inspected.reason);
    const baseline = gradeCandidate(staged.workspace, spec.originalApplies);
    assert.equal(baseline.invalid_reason, undefined, 'host-baseline-evaluator-failed');
    return {
      index,
      modelRoot: keep ? modelRoot : undefined,
      rawDirectory: keep ? rawDirectory : undefined,
      staged: staged.hashes,
      boundary,
      publicCheck,
      inspected,
      baseline: {
        exact: baseline.exact,
        diagnosis_correct: baseline.diagnosis_correct,
        runtime_unaffected: baseline.runtime_unaffected,
        business_continues: baseline.business_continues,
        installed_worker_follow_version: baseline.installed_worker_follow_version,
      },
    };
  } finally {
    if (!keep) {
      fs.rmSync(modelRoot, { recursive: true, force: true });
      fs.rmSync(rawDirectory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3);
  const result = preflight(Number(process.argv[2]));
  process.stdout.write(
    `${JSON.stringify({
      index: result.index,
      boundary: result.boundary,
      public_check: result.publicCheck,
      baseline: result.baseline,
    })}\n`,
  );
}
