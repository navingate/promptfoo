import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildDockerArgs,
  inspectReleaseImage,
  materializeSource,
  VELERO_REVISION,
} from './velero-release-evaluator.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const overlaySha256 = (files) => sha256(JSON.stringify(Object.entries(files).sort()));

function checkedCommand(binary, args, options = {}) {
  const run = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 12_000_000,
    ...options,
  });
  return {
    status: run.status,
    error: run.error?.message ?? null,
    log: `${run.stdout ?? ''}${run.stderr ?? ''}`,
  };
}

export function runTaggedBuild({ sourceRepo, files, label }) {
  const scratch = mkdtempSync(join(tmpdir(), 'f8-v25-reviewed-build-'));
  const source = join(scratch, 'public-source');
  const tag = `candidate-release:${overlaySha256(files).slice(0, 16)}`;
  try {
    materializeSource({
      sourceRepo,
      revision: VELERO_REVISION,
      destination: source,
      files,
    });
    const args = buildDockerArgs(tag);
    const build = checkedCommand('docker', args, { cwd: source });
    if (build.status !== 0) {
      return { ...build, label, tag, args, imageDigest: null };
    }
    const image = checkedCommand('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], {
      timeout: 30_000,
    });
    if (image.status !== 0) {
      throw new Error(
        `trusted local image inspection failed: ${image.error ?? image.log.slice(-500)}`,
      );
    }
    return { ...build, label, tag, args, imageDigest: image.log.trim() };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function buildReviewedRelease({
  sourceRepo,
  files,
  benignInput,
  approval,
  requestSha256,
  build = runTaggedBuild,
  inspect = inspectReleaseImage,
  recordBuild = () => {},
}) {
  const sourceSha256 = overlaySha256(files);
  assert.deepEqual(Object.keys(approval ?? {}).sort(), [
    'decision',
    'requestSha256',
    'sourceSha256',
  ]);
  if (
    approval.decision !== 'approve' ||
    approval.sourceSha256 !== sourceSha256 ||
    approval.requestSha256 !== requestSha256
  ) {
    throw new Error('source execution lacks matching safety approval');
  }
  const candidate = build({ sourceRepo, files, label: 'candidate' });
  recordBuild('candidate', candidate);
  if (candidate.error || candidate.status === null) {
    throw new Error('candidate build transport failed');
  }
  if (candidate.status !== 0) {
    const baseline = build({ sourceRepo, files: {}, label: 'baseline' });
    recordBuild('baseline', baseline);
    if (baseline.status !== 0) {
      throw new Error('matching unchanged release build also failed');
    }
    return {
      status: candidate.status,
      logTail: candidate.log.slice(-16_000),
      buildLogSha256: sha256(candidate.log),
      baselineLogSha256: sha256(baseline.log),
      failureKind: 'candidate_build_failed_with_baseline_pass',
    };
  }
  const inspection = inspect(candidate.tag, benignInput);
  return {
    status: 0,
    imageDigest: candidate.imageDigest,
    binaries: [
      { artifactPath: '/velero', ...inspection.binaries.velero },
      { artifactPath: '/usr/bin/restic', ...inspection.binaries.restic },
    ],
    main: inspection.main,
    restore: inspection.restore,
    logTail: candidate.log.slice(-16_000),
    buildLogSha256: sha256(candidate.log),
  };
}
