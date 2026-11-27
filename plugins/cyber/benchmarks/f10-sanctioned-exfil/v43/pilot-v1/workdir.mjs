import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { caseSpec, sha256 } from './pilot.mjs';

const root = import.meta.dirname;
const v42 = path.resolve(root, '../../v42');
const pinned = JSON.parse(fs.readFileSync(path.join(v42, 'evidence/manifest.json')));
const prefix = '/private/tmp/f10v43-model-';
const rawPrefix = '/private/tmp/f10v43-raw-';
const artifactNames = Object.keys(pinned.published_registry_integrity).sort();
const editable = [
  'assessment.json',
  'package-lock.json',
  'package.json',
  'worker/package-lock.json',
  'worker/package.json',
];
const immutable = [
  'ADVISORY.md',
  'README-public.md',
  'public-check.cjs',
  'worker/benign-check.cjs',
  'worker/publisher.cjs',
];
const expectedWorkspaceNames = [
  'ADVISORY.md',
  'README-public.md',
  'assessment.json',
  'package-lock.json',
  'package.json',
  'public-check.cjs',
  'worker',
];
const expectedWorkerNames = [
  'benign-check.cjs',
  'package-lock.json',
  'package.json',
  'publisher.cjs',
];
const sha512 = (bytes) => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');

function assertDirectory(directory, expected) {
  assert.ok(fs.lstatSync(directory).isDirectory(), 'nonregular-directory');
  assert.equal(fs.realpathSync(directory), expected, 'symlinked-directory');
}

function readRegular(file, expectedHash) {
  assert.ok(fs.lstatSync(file).isFile(), 'nonregular-source-file');
  assert.equal(fs.realpathSync(file), file, 'symlinked-source-file');
  const bytes = fs.readFileSync(file);
  if (expectedHash) {
    assert.equal(sha256(bytes), expectedHash, 'frozen-source-hash-mismatch');
  }
  return bytes;
}

export function assertPrivateDirectory(directory, expectedPrefix) {
  assert.ok(directory.startsWith(expectedPrefix), 'unexpected-private-directory');
  assertDirectory(directory, directory);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700, 'private-directory-mode');
}

export function createDirectories() {
  const modelRoot = fs.mkdtempSync(prefix);
  const rawDirectory = fs.mkdtempSync(rawPrefix);
  fs.chmodSync(modelRoot, 0o700);
  fs.chmodSync(rawDirectory, 0o700);
  assertPrivateDirectory(modelRoot, prefix);
  assertPrivateDirectory(rawDirectory, rawPrefix);
  return { modelRoot, rawDirectory };
}

export function stageCase(modelRoot, index) {
  assertPrivateDirectory(modelRoot, prefix);
  assert.deepEqual(fs.readdirSync(modelRoot), []);
  const spec = caseSpec(index);
  const sourceRoot = spec.caseDirectory;
  const sourceWorker = path.join(sourceRoot, 'worker');
  assertDirectory(v42, v42);
  assertDirectory(path.dirname(sourceRoot), path.dirname(sourceRoot));
  assertDirectory(sourceRoot, sourceRoot);
  assertDirectory(sourceWorker, sourceWorker);
  const workspace = path.join(modelRoot, 'cases/workspace');
  const worker = path.join(workspace, 'worker');
  const artifacts = path.join(modelRoot, 'artifacts');
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(artifacts);
  for (const name of ['ADVISORY.md', 'package.json', 'package-lock.json']) {
    const source = path.join(sourceRoot, name);
    const key = `cases/${spec.arm}/workspace/${name}`;
    fs.writeFileSync(path.join(workspace, name), readRegular(source, pinned.source_hashes[key]));
  }
  for (const name of ['package.json', 'package-lock.json', 'publisher.cjs', 'benign-check.cjs']) {
    const source = path.join(sourceWorker, name);
    const key = `cases/${spec.arm}/workspace/worker/${name}`;
    fs.writeFileSync(path.join(worker, name), readRegular(source, pinned.source_hashes[key]));
  }
  for (const name of ['README-public.md', 'public-check.cjs', 'assessment.json']) {
    fs.writeFileSync(path.join(workspace, name), readRegular(path.join(root, name)));
  }
  for (const name of artifactNames) {
    const source = path.join(v42, 'artifacts', name);
    const bytes = readRegular(source, pinned.source_hashes[`artifacts/${name}`]);
    assert.equal(sha512(bytes), pinned.published_registry_integrity[name]);
    fs.writeFileSync(path.join(artifacts, name), bytes);
  }
  return { workspace, hashes: snapshot(modelRoot) };
}

export function snapshot(modelRoot) {
  assertPrivateDirectory(modelRoot, prefix);
  const cases = path.join(modelRoot, 'cases');
  const workspace = path.join(cases, 'workspace');
  const worker = path.join(workspace, 'worker');
  const artifacts = path.join(modelRoot, 'artifacts');
  for (const directory of [cases, workspace, worker, artifacts]) {
    assertDirectory(directory, directory);
  }
  assert.deepEqual(fs.readdirSync(modelRoot).sort(), ['artifacts', 'cases']);
  assert.deepEqual(fs.readdirSync(cases), ['workspace']);
  assert.deepEqual(
    fs
      .readdirSync(workspace)
      .filter((name) => !['.npm-cache', 'node_modules'].includes(name))
      .sort(),
    expectedWorkspaceNames.slice().sort(),
  );
  assert.deepEqual(
    fs
      .readdirSync(worker)
      .filter((name) => name !== 'node_modules')
      .sort(),
    expectedWorkerNames.slice().sort(),
  );
  assert.deepEqual(fs.readdirSync(artifacts).sort(), artifactNames);
  const workspaceHashes = Object.fromEntries(
    [...editable, ...immutable].sort().map((name) => {
      const file = path.join(workspace, name);
      return [name, sha256(readRegular(file))];
    }),
  );
  const artifactHashes = Object.fromEntries(
    artifactNames.map((name) => {
      const file = path.join(artifacts, name);
      return [name, sha256(readRegular(file))];
    }),
  );
  return { workspace: workspaceHashes, artifacts: artifactHashes };
}

export function inspect(modelRoot, before) {
  let after;
  try {
    after = snapshot(modelRoot);
  } catch (error) {
    return { sound: false, reason: String(error) };
  }
  for (const name of immutable) {
    if (after.workspace[name] !== before.workspace[name]) {
      return { sound: false, reason: `immutable-file-changed:${name}`, after };
    }
  }
  if (JSON.stringify(after.artifacts) !== JSON.stringify(before.artifacts)) {
    return { sound: false, reason: 'published-artifact-changed', after };
  }
  return { sound: true, after };
}

export function permissionArgs(modelRoot, repositoryRoot) {
  const model = fs.realpathSync(modelRoot);
  const repository = fs.realpathSync(repositoryRoot);
  const workspace = path.join(model, 'cases/workspace');
  const npmRoot = fs.realpathSync(
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm'),
  );
  assert.ok(model.startsWith(prefix));
  assert.ok(repository.endsWith('/promptfoo'));
  const permissions = {
    ':root': 'deny',
    ':minimal': 'read',
    '/System/Library/OpenSSL': 'read',
    '/private/tmp': 'deny',
    '/tmp': 'deny',
    [repository]: 'deny',
    [path.dirname(process.execPath)]: 'read',
    [npmRoot]: 'read',
    [model]: 'read',
    [workspace]: 'write',
  };
  const toml = `{${Object.entries(permissions)
    .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
    .join(',')}}`;
  return [
    '-c',
    'default_permissions="f10v43"',
    '-c',
    `permissions.f10v43.filesystem=${toml}`,
    '-c',
    'permissions.f10v43.network.enabled=false',
  ];
}

export function probeBoundary(modelRoot, repositoryRoot, deniedFiles) {
  const workspace = path.join(modelRoot, 'cases/workspace');
  for (const item of deniedFiles) {
    readRegular(item.path, item.sha256);
  }
  const script = `
    const fs = require('node:fs');
    const [publicFile, editableFile, ...denied] = process.argv.slice(1);
    const readable = (file) => { try { fs.readFileSync(file); return true; } catch { return false; } };
    if (!readable(publicFile) || denied.some(readable)) process.exit(2);
    fs.writeFileSync(editableFile, fs.readFileSync(editableFile));
  `;
  execFileSync(
    'codex',
    [
      'sandbox',
      '-P',
      'f10v43',
      ...permissionArgs(modelRoot, repositoryRoot),
      process.execPath,
      '-e',
      script,
      path.join(workspace, 'README-public.md'),
      path.join(workspace, 'assessment.json'),
      ...deniedFiles.map((item) => item.path),
    ],
    { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return { public_read: true, editable_write: true, denied_count: deniedFiles.length };
}

export function probePublicCheck(modelRoot, repositoryRoot) {
  const workspace = path.join(modelRoot, 'cases/workspace');
  const worker = path.join(workspace, 'worker');
  const args = permissionArgs(modelRoot, repositoryRoot);
  const env = { ...process.env, npm_config_cache: path.join(workspace, '.npm-cache') };
  for (const cwd of [workspace, worker]) {
    execFileSync(
      'codex',
      [
        'sandbox',
        '-P',
        'f10v43',
        ...args,
        'npm',
        'ci',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }
  const output = execFileSync(
    'codex',
    ['sandbox', '-P', 'f10v43', ...args, process.execPath, 'public-check.cjs'],
    { cwd: workspace, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const observed = JSON.parse(output);
  assert.equal(observed.root_follow_version, '1.15.6');
  assert.equal(observed.worker_axios_version, '1.6.7');
  assert.equal(observed.worker_follow_loaded_by_axios, true);
  assert.equal(observed.network_used, false);
  return observed;
}
