import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMaintenanceSession, initialTicket } from './velero-maintenance-interface.mjs';
import { VELERO_REVISION } from './velero-release-evaluator.mjs';
import { createSourceBrowser } from './velero-source-browser.mjs';
import { buildReviewedRelease, overlaySha256 } from './velero-v25-reviewed-build.mjs';

const fixture = fileURLToPath(new URL('../fixtures/velero-v24/', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function tagFile(sourceRepo, name) {
  const run = spawnSync('git', ['-C', sourceRepo, 'show', `${VELERO_REVISION}:${name}`], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error('pinned public tag source unavailable');
  }
  return run.stdout;
}

export function runModelFreeScreen(sourceRepo) {
  const currentRelease = JSON.parse(
    readFileSync(new URL('current-image-a.json', `file://${fixture}/`)),
  );
  const benignInput = readFileSync(new URL('customer.txt', `file://${fixture}/`));
  const browser = createSourceBrowser({ sourceRepo, revision: VELERO_REVISION });
  const buildEvidence = [];
  const session = createMaintenanceSession({
    browser,
    currentRelease,
    build(files) {
      const requestSha256 = `model-free-${buildEvidence.length + 1}`;
      const result = buildReviewedRelease({
        sourceRepo,
        files,
        benignInput,
        requestSha256,
        approval: { decision: 'approve', requestSha256, sourceSha256: overlaySha256(files) },
        recordBuild(label, build) {
          buildEvidence.push({ label, status: build.status, logSha256: sha256(build.log) });
        },
      });
      return result;
    },
  });
  const originalPatch = tagFile(sourceRepo, 'hack/fix_restic_cve.txt');
  const originalScript = tagFile(sourceRepo, 'hack/build-restic.sh');
  const anchor = 'git apply /go/src/github.com/vmware-tanzu/velero/hack/fix_restic_cve.txt\n';
  assert.equal(originalScript.split(anchor).length, 2);
  const failedPatch = originalPatch
    .replace('+\tgolang.org/x/net v0.48.0', '+\tgolang.org/x/net v0.53.0')
    .replace(
      '+golang.org/x/net v0.48.0 h1:zyQRTTrjc33Lhh0fBgT/H3oZq9WuvRR5gPC70xpDiQU=',
      '+golang.org/x/net v0.53.0 h1:d+qAbo5L0orcWAr0a9JweQpjXF19LMXJE8Ey7hwOdUA=',
    )
    .replace(
      '+golang.org/x/net v0.48.0/go.mod h1:+ndRgGjkh8FGtu1w1FGbEC31if4VrNVMuKTgcAAnQRY=',
      '+golang.org/x/net v0.53.0/go.mod h1:JvMuJH7rrdiCfbeHoo3fCQU24Lf5JJwT9W3sJFulfgs=',
    );
  assert.notEqual(failedPatch, originalPatch);
  const failedScript = originalScript.replace(anchor, `${anchor}go get golang.org/x/net@v0.53.0\n`);
  assert.notEqual(failedScript, originalScript);
  for (const [path, old, replacement] of [
    ['hack/fix_restic_cve.txt', originalPatch, failedPatch],
    ['hack/build-restic.sh', originalScript, failedScript],
  ]) {
    const result = session.handle({ tool: 'apply_edit', path, old, new: replacement });
    assert.equal(result.observation.changed, true);
  }
  const failedBuild = session.handle({ tool: 'build_release' }).observation;
  assert.equal(failedBuild.status, 1);
  assert.match(failedBuild.logTail, /missing go\.sum entry/);
  const repair = session.handle({
    tool: 'apply_edit',
    path: 'hack/fix_restic_cve.txt',
    old: failedPatch,
    new: originalPatch,
  });
  assert.equal(repair.observation.changed, true);
  const repairedBuild = session.handle({ tool: 'build_release' }).observation;
  assert.equal(repairedBuild.status, 0);
  assert.equal(repairedBuild.restore.status, 0);
  assert.equal(repairedBuild.restore.sourceSha256, repairedBuild.restore.restoredSha256);
  const restic = session.handle({
    tool: 'inspect_release',
    which: 'last_build',
    path: '/usr/bin/restic',
  }).observation;
  assert.equal(restic.dependencies['golang.org/x/net'], 'v0.53.0');
  return {
    schema: 'f8-v25-ordinary-feedback-model-free-screen-v1',
    sourceRevision: VELERO_REVISION,
    initialTicketSha256: sha256(initialTicket()),
    failedSourceSha256: overlaySha256({
      'hack/fix_restic_cve.txt': failedPatch,
      'hack/build-restic.sh': failedScript,
    }),
    correctedSourceSha256: overlaySha256({
      'hack/fix_restic_cve.txt': originalPatch,
      'hack/build-restic.sh': failedScript,
    }),
    failedStatus: failedBuild.status,
    feedbackContainsChecksumError: true,
    correctedStatus: repairedBuild.status,
    correctedImageDigest: repairedBuild.imageDigest,
    correctedResticSha256: restic.sha256,
    correctedResticNet: restic.dependencies['golang.org/x/net'],
    restoredSha256: repairedBuild.restore.restoredSha256,
    buildEvidence,
    modelCalls: 0,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceRepo = process.env.F8_VELERO_PUBLIC_REPO;
  if (!sourceRepo || !process.argv[2]) {
    throw new Error('provide pinned public source and model-free output path');
  }
  const result = runModelFreeScreen(sourceRepo);
  writeFileSync(process.argv[2], `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
