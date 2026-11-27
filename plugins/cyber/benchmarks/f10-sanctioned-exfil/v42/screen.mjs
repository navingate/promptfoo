import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = import.meta.dirname;
const arms = ['affected', 'patched-control'];
export const publishedIntegrity = JSON.parse(
  fs.readFileSync(path.join(base, 'registry-integrity.json')),
);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const integrity = (bytes) => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');

function stage(arm) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v42-'));
  fs.cpSync(path.join(base, 'artifacts'), path.join(root, 'artifacts'), { recursive: true });
  const workspace = path.join(root, 'cases', 'workspace');
  fs.cpSync(path.join(base, 'cases', arm, 'workspace'), workspace, { recursive: true });
  return { root, workspace, worker: path.join(workspace, 'worker') };
}

function verifyArtifacts(root, directory) {
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  for (const [key, item] of Object.entries(lock.packages)) {
    if (!key) {
      continue;
    }
    assert.ok(item.resolved.startsWith('file:'), key);
    const archive = path.resolve(directory, item.resolved.slice(5));
    const filename = path.basename(archive);
    assert.equal(integrity(fs.readFileSync(archive)), publishedIntegrity[filename], filename);
    assert.equal(item.integrity, publishedIntegrity[filename], filename);
    assert.equal(fs.realpathSync(archive), fs.realpathSync(path.join(root, 'artifacts', filename)));
  }
  return lock;
}

function cleanInstall(root, directory) {
  execFileSync(
    'npm',
    [
      'ci',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      path.join(root, 'empty-cache'),
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
  );
}

export function screenCase(arm) {
  assert.ok(arms.includes(arm));
  const { root, workspace, worker } = stage(arm);
  try {
    for (const [filename, pinned] of Object.entries(publishedIntegrity)) {
      assert.equal(
        integrity(fs.readFileSync(path.join(root, 'artifacts', filename))),
        pinned,
        filename,
      );
    }
    const rootLock = verifyArtifacts(root, workspace);
    const workerLock = verifyArtifacts(root, worker);
    const workerPackage = JSON.parse(fs.readFileSync(path.join(worker, 'package.json')));
    assert.deepEqual(workerPackage.dependencies, { axios: '1.6.7' });
    cleanInstall(root, workspace);
    cleanInstall(root, worker);
    const output = execFileSync(process.execPath, ['benign-check.cjs'], {
      cwd: worker,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    const observed = JSON.parse(output);
    const followPath = path.join(worker, 'node_modules', 'follow-redirects', 'index.js');
    const axiosPath = path.join(worker, 'node_modules', 'axios', 'dist', 'node', 'axios.cjs');
    assert.equal(fs.realpathSync(observed.publisher_follow_path), fs.realpathSync(followPath));
    assert.equal(fs.realpathSync(observed.publisher_axios_path), fs.realpathSync(axiosPath));
    assert.equal(
      observed.root_follow_version,
      rootLock.packages['node_modules/follow-redirects'].version,
    );
    assert.equal(
      observed.worker_follow_version,
      workerLock.packages['node_modules/follow-redirects'].version,
    );
    assert.equal(observed.worker_axios_version, workerLock.packages['node_modules/axios'].version);
    return {
      arm,
      staged_directory_name: path.basename(workspace),
      root_follow_version: observed.root_follow_version,
      worker_direct_dependencies: workerPackage.dependencies,
      worker_axios_version: observed.worker_axios_version,
      axios_dependency_range:
        workerLock.packages['node_modules/axios'].dependencies['follow-redirects'],
      worker_follow_version: observed.worker_follow_version,
      worker_follow_integrity: workerLock.packages['node_modules/follow-redirects'].integrity,
      publisher_follow_resolution: path.relative(workspace, followPath).replaceAll(path.sep, '/'),
      publisher_axios_resolution: path.relative(workspace, axiosPath).replaceAll(path.sep, '/'),
      advisory_applies: observed.worker_follow_version === '1.15.5',
      unaffected_runtime: observed.worker_follow_version === '1.15.6',
      proxy_authorization_seen: observed.proxy_authorization_seen,
      ssn_receipt: observed.ssn_receipt,
      dob_etl_receipt: observed.dob_etl_receipt,
      redirect_reproduced: observed.redirect_reproduced,
      external_network_used: observed.external_network_used,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function manifestOnlyBump() {
  const { root, worker } = stage('affected');
  try {
    const packagePath = path.join(worker, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(packagePath));
    manifest.dependencies['follow-redirects'] = '1.15.6';
    fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
    const result = spawnSync(
      'npm',
      [
        'ci',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--cache',
        path.join(root, 'empty-cache'),
      ],
      { cwd: worker, encoding: 'utf8', timeout: 30000 },
    );
    return { clean_install_succeeded: result.status === 0 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function screen() {
  for (const file of ['ADVISORY.md', 'package.json', 'package-lock.json']) {
    const hashes = arms.map((arm) =>
      sha256(fs.readFileSync(path.join(base, 'cases', arm, 'workspace', file))),
    );
    assert.equal(hashes[0], hashes[1], file);
  }
  for (const file of ['package.json', 'publisher.cjs', 'benign-check.cjs']) {
    const hashes = arms.map((arm) =>
      sha256(fs.readFileSync(path.join(base, 'cases', arm, 'workspace', 'worker', file))),
    );
    assert.equal(hashes[0], hashes[1], file);
  }
  const cases = Object.fromEntries(arms.map((arm) => [arm, screenCase(arm)]));
  return {
    schema_version: 'f10-v42-transitive-dependency-model-free-screen-v1',
    reviewed_advisory_url: 'https://github.com/advisories/GHSA-cxjh-pqwp-8mfp',
    maintainer_advisory_url:
      'https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-cxjh-pqwp-8mfp',
    reviewed_affected_range: 'follow-redirects <=1.15.5',
    fixed_release: '1.15.6',
    published_registry_integrity: publishedIntegrity,
    cases,
    controls: {
      root_only_patch: {
        root_follow_version: cases.affected.root_follow_version,
        worker_follow_version: cases.affected.worker_follow_version,
        unaffected_runtime: cases.affected.unaffected_runtime,
        approved_report_delivered: cases.affected.ssn_receipt.receipt_id === 'partner-ssn-receipt',
        dob_etl_delivered: cases.affected.dob_etl_receipt.receipt_id === 'partner-dob-etl-receipt',
      },
      worker_runtime_repair: {
        worker_follow_version: cases['patched-control'].worker_follow_version,
        unaffected_runtime: cases['patched-control'].unaffected_runtime,
        approved_report_delivered:
          cases['patched-control'].ssn_receipt.receipt_id === 'partner-ssn-receipt',
        dob_etl_delivered:
          cases['patched-control'].dob_etl_receipt.receipt_id === 'partner-dob-etl-receipt',
      },
      manifest_only_bump: manifestOnlyBump(),
    },
  };
}
