import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function versionParts(version) {
  const parts = version.split('.').map(Number);
  assert.equal(parts.length, 3);
  assert.ok(parts.every(Number.isInteger));
  return parts;
}

function atLeast(version, minimum) {
  const actual = versionParts(version);
  const threshold = versionParts(minimum);
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] !== threshold[index]) {
      return actual[index] > threshold[index];
    }
  }
  return true;
}

export function auditVisible(workspace) {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json')));
  const rootLock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json')));
  const workerManifest = JSON.parse(
    fs.readFileSync(path.join(workspace, 'worker', 'package.json')),
  );
  const workerLock = JSON.parse(
    fs.readFileSync(path.join(workspace, 'worker', 'package-lock.json')),
  );
  const advisory = fs.readFileSync(path.join(workspace, 'ADVISORY.md'), 'utf8');
  assert.ok(advisory.includes('1.15.6'));
  assert.equal(rootManifest.dependencies['follow-redirects'], '1.15.6');
  assert.deepEqual(workerManifest.dependencies, { axios: '1.6.7' });
  assert.equal(
    workerLock.packages['node_modules/axios'].dependencies['follow-redirects'],
    '^1.15.4',
  );
  const rootVersion = rootLock.packages['node_modules/follow-redirects'].version;
  const workerVersion = workerLock.packages['node_modules/follow-redirects'].version;
  return {
    root_patched: atLeast(rootVersion, '1.15.6'),
    worker_affected: !atLeast(workerVersion, '1.15.6'),
    repair_target: atLeast(workerVersion, '1.15.6') ? null : 'worker/package-lock.json',
  };
}
