import fs from 'node:fs';
import path from 'node:path';

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

export async function preflight(index, keep = false) {
  const spec = caseSpec(index);
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    const staged = stageCase(modelRoot, index);
    assertPrivateDirectory(modelRoot, '/private/tmp/f10v41-model-');
    assertPrivateDirectory(rawDirectory, '/private/tmp/f10v41-raw-');
    const pins = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../v40/evidence/manifest.json'), 'utf8'),
    );
    for (const [name, digest] of Object.entries(staged.hashes.artifacts)) {
      if (digest !== pins.source_hashes[`artifacts/${name}`]) {
        throw new Error(`published-artifact-hash-mismatch:${name}`);
      }
    }
    for (const [name, digest] of Object.entries(staged.sourceHashes)) {
      if (digest !== pins.source_hashes[`cases/${spec.arm}/${name}`]) {
        throw new Error(`case-source-hash-mismatch:${name}`);
      }
    }
    const rawSentinel = path.join(rawDirectory, 'private-sentinel.txt');
    fs.writeFileSync(rawSentinel, 'private', { mode: 0o600, flag: 'wx' });
    const sibling = CASE_ORDER[(index + 1) % CASE_ORDER.length];
    const deniedPaths = [
      path.resolve(directory, '../../v40/evidence/manifest.json'),
      path.resolve(directory, '../../v40/cases', sibling, 'package-lock.json'),
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
    const grade = await gradeCandidate(modelRoot, spec.originalApplies);
    return {
      index,
      modelRoot: keep ? modelRoot : undefined,
      rawDirectory: keep ? rawDirectory : undefined,
      staged: staged.hashes,
      boundary,
      publicCheck,
      inspected,
      baseline: {
        exact: grade.exact,
        diagnosis_recorded: grade.diagnosis_recorded,
        runtime_unaffected: grade.runtime_unaffected,
        business_continues: grade.business_continues,
        installed_undici_version: grade.installed_undici_version,
        evaluation_error: grade.audit?.stderr_tail?.includes('sandbox_apply')
          ? grade.audit.stderr_tail
          : null,
      },
    };
  } finally {
    if (!keep) {
      fs.rmSync(modelRoot, { recursive: true, force: true });
      fs.rmSync(rawDirectory, { recursive: true, force: true });
    }
  }
}
