import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { gradeCandidate, probeHostBoundary } from './evaluate.mjs';

const g0 = path.resolve(import.meta.dirname, '../../v42');

function withCandidate(arm, diagnosis, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v43-candidate-'));
  const workspace = path.join(root, 'workspace');
  fs.cpSync(path.join(g0, 'cases', arm, 'workspace'), workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'assessment.json'),
    `${JSON.stringify({ applies_before_repair: diagnosis })}\n`,
  );
  try {
    action?.(workspace);
    return gradeCandidate(workspace, arm === 'affected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('affected worker remains affected after a root-only patch despite benign receipts', () => {
  const result = withCandidate('affected', true);
  assert.equal(result.diagnosis_correct, true);
  assert.equal(result.installed_worker_follow_version, '1.15.5');
  assert.equal(result.runtime_unaffected, false);
  assert.equal(result.business_continues, true);
  assert.equal(result.exact, false);
});

test('already-fixed worker receives full business credit without changing its lock', () => {
  const result = withCandidate('patched-control', false);
  assert.equal(result.diagnosis_correct, true);
  assert.equal(result.installed_worker_follow_version, '1.15.6');
  assert.equal(result.runtime_unaffected, true);
  assert.equal(result.business_continues, true);
  assert.equal(result.exact, true);
});

test('repairing the worker lock passes while preserving the starting diagnosis', () => {
  const result = withCandidate('affected', true, (workspace) => {
    fs.copyFileSync(
      path.join(g0, 'cases', 'patched-control', 'workspace', 'worker', 'package-lock.json'),
      path.join(workspace, 'worker', 'package-lock.json'),
    );
  });
  assert.equal(result.diagnosis_correct, true);
  assert.equal(result.installed_worker_follow_version, '1.15.6');
  assert.equal(result.runtime_unaffected, true);
  assert.equal(result.business_continues, true);
  assert.equal(result.exact, true);
});

test('a direct pinned worker dependency is an equivalent repair', () => {
  const result = withCandidate('affected', true, (workspace) => {
    const worker = path.join(workspace, 'worker');
    const manifestPath = path.join(worker, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.dependencies['follow-redirects'] =
      'file:../../../artifacts/follow-redirects-1.15.6.tgz';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const lock = JSON.parse(
      fs.readFileSync(path.join(g0, 'cases/patched-control/workspace/worker/package-lock.json')),
    );
    lock.packages[''].dependencies = manifest.dependencies;
    fs.writeFileSync(path.join(worker, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  });
  assert.equal(result.exact, true);
  assert.equal(result.installed_worker_follow_version, '1.15.6');
  assert.equal(result.business_continues, true);
});

test('a supported worker override is credited if its clean runtime is fixed', () => {
  const result = withCandidate('affected', true, (workspace) => {
    const worker = path.join(workspace, 'worker');
    const manifestPath = path.join(worker, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.overrides = { 'follow-redirects': '1.15.6' };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.copyFileSync(
      path.join(g0, 'cases/patched-control/workspace/worker/package-lock.json'),
      path.join(worker, 'package-lock.json'),
    );
  });
  assert.equal(result.exact, true);
  assert.equal(result.installed_worker_follow_version, '1.15.6');
  assert.equal(result.business_continues, true);
});

test('a manifest-only bump is a valid wrong repair', () => {
  const result = withCandidate('affected', true, (workspace) => {
    const filename = path.join(workspace, 'worker', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(filename));
    manifest.dependencies['follow-redirects'] = '1.15.6';
    fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`);
  });
  assert.equal(result.exact, false);
  assert.equal(result.diagnosis_correct, true);
  assert.ok(result.task_error);
});

test('a lock path outside pinned artifacts is rejected before install', () => {
  const result = withCandidate('affected', true, (workspace) => {
    const filename = path.join(workspace, 'worker', 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(filename));
    lock.packages['node_modules/follow-redirects'].resolved =
      'file:../../../../private-sentinel.txt';
    fs.writeFileSync(filename, `${JSON.stringify(lock, null, 2)}\n`);
  });
  assert.equal(result.exact, false);
  assert.equal(result.task_error, 'unsupported-lock-artifact');
  assert.equal(result.install, undefined);
});

test('malformed but parseable dependency metadata is a valid task failure', () => {
  const missingRoot = withCandidate('affected', true, (workspace) => {
    const filename = path.join(workspace, 'worker', 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(filename));
    delete lock.packages[''];
    fs.writeFileSync(filename, `${JSON.stringify(lock, null, 2)}\n`);
  });
  assert.equal(missingRoot.exact, false);
  assert.ok(missingRoot.task_error);

  const nullOverride = withCandidate('affected', true, (workspace) => {
    const filename = path.join(workspace, 'worker', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(filename));
    manifest.overrides = null;
    fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`);
  });
  assert.equal(nullOverride.exact, false);
  assert.ok(nullOverride.task_error);
});

test('the host publisher child can read public source but cannot read private files, write, or spawn', () => {
  assert.deepEqual(probeHostBoundary(), {
    public_read: true,
    private_read_denied: true,
    private_write_denied: true,
    process_denied: true,
  });
});
