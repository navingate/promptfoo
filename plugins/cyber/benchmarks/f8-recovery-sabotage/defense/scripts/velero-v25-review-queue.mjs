import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertSafeWithin } from './dependency-pilot-runner.mjs';
import { VELERO_REVISION } from './velero-release-evaluator.mjs';
import { buildReviewedRelease, overlaySha256 } from './velero-v25-reviewed-build.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function writeExclusive(root, name, value) {
  const path = assertSafeWithin(root, join(root, name));
  writeFileSync(path, value, { flag: 'wx' });
  if (!lstatSync(path).isFile()) {
    throw new Error('private review evidence is not regular');
  }
  return { file: name, sha256: sha256(value) };
}

function readApproval(root, name) {
  const path = assertSafeWithin(root, join(root, name));
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) {
    return null;
  }
  if (!entry.isFile()) {
    throw new Error('safety approval must be a regular file');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function waitForApproval(root, name) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const approval = readApproval(root, name);
    if (approval) {
      return approval;
    }
    Atomics.wait(pause, 0, 0, 2000);
  }
}

export function createReviewQueue({
  rawDir,
  sourceRepo,
  benignInput,
  candidateCommit,
  freezeSha256,
  caseNumber,
  attemptNumber,
  approvalProvider = waitForApproval,
  releaseBuilder = buildReviewedRelease,
}) {
  let reviewNumber = 0;
  return {
    review(files, kind) {
      if (!['preview', 'final'].includes(kind)) {
        throw new Error('unknown source review kind');
      }
      reviewNumber++;
      const prefix = `case-${caseNumber}-attempt-${attemptNumber}-review-${reviewNumber}`;
      const request = {
        schema: 'f8-v25-exact-source-review-v1',
        candidateCommit,
        freezeSha256,
        caseNumber,
        attemptNumber,
        reviewNumber,
        kind,
        sourceRevision: VELERO_REVISION,
        sourceSha256: overlaySha256(files),
        files,
      };
      const requestBytes = `${JSON.stringify(request, null, 2)}\n`;
      const requestRecord = writeExclusive(rawDir, `${prefix}-request.json`, requestBytes);
      const approvalName = `${prefix}-approval.json`;
      const approval = approvalProvider(rawDir, approvalName, request);
      const approvalBytes = readFileSync(assertSafeWithin(rawDir, join(rawDir, approvalName)));
      if (
        JSON.stringify(approval) !== JSON.stringify(JSON.parse(approvalBytes)) ||
        approval.requestSha256 !== requestRecord.sha256 ||
        approval.sourceSha256 !== request.sourceSha256
      ) {
        throw new Error('safety approval does not bind exact pending source');
      }
      if (approval.decision !== 'approve') {
        throw new Error('source safety review denied execution');
      }
      const logs = {};
      const result = releaseBuilder({
        sourceRepo,
        files,
        benignInput,
        approval,
        requestSha256: requestRecord.sha256,
        recordBuild(label, build) {
          logs[label] = writeExclusive(rawDir, `${prefix}-${label}-build.log`, build.log);
        },
      });
      writeExclusive(
        rawDir,
        `${prefix}-result.json`,
        `${JSON.stringify(
          {
            request: requestRecord,
            approval: { file: approvalName, sha256: sha256(approvalBytes) },
            logs,
            status: result.status,
            imageDigest: result.imageDigest ?? null,
            buildLogSha256: result.buildLogSha256,
            baselineLogSha256: result.baselineLogSha256 ?? null,
          },
          null,
          2,
        )}\n`,
      );
      return result;
    },
    reviewCount() {
      return reviewNumber;
    },
  };
}
