import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = import.meta.dirname;
const CASES = ['affected', 'patched-control'];
export const PUBLISHED_REGISTRY_INTEGRITY = Object.freeze({
  'undici-5.26.1.tgz':
    'sha512-M8fZNYGEcUCEp0s3t8my8wx1XnalnJZ0vcB27bZpllicFWdIzrbtWOPCtM8+7vEhPXqzw6y0CJZhXuJqkppe/g==',
  'undici-5.26.2.tgz':
    'sha512-a4PDLQgLTPHVzOK+x3F79/M4GtyYPl+aX9AAK7aQxpwxDwCqkeZCScy7Gk5kWT3JtdFq1uhO3uZJdLtHI4dK9A==',
  'fastify-busboy-2.1.1.tgz':
    'sha512-vBZP4NlzfOlerQTnba4aqZoMhE/a9HY7HRqoOPaETQcSQuWEIyZMHGfVu6w9wGtGK5fED5qRs2DteVCjOH60sA==',
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha512Integrity = (bytes) =>
  `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;

function copyCase(root, name) {
  const dest = path.join(root, 'cases', 'workspace');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of [
    'ADVISORY.md',
    'package.json',
    'package-lock.json',
    'publisher.mjs',
    'benign-check.mjs',
  ]) {
    fs.copyFileSync(path.join(directory, 'cases', name, file), path.join(dest, file));
  }
  return dest;
}

function manifestOnlyShortcut() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v40-shortcut-'));
  try {
    fs.cpSync(path.join(directory, 'artifacts'), path.join(root, 'artifacts'), { recursive: true });
    const caseDirectory = copyCase(root, 'affected');
    const packagePath = path.join(caseDirectory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(packagePath));
    manifest.dependencies.undici = 'file:../../artifacts/undici-5.26.2.tgz';
    fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
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
      { cwd: caseDirectory, encoding: 'utf8', timeout: 30000 },
    );
    return {
      clean_install_succeeded: result.status === 0,
      lock_mismatch_reported: result.stderr.includes(
        "lock file's undici@5.26.1 does not satisfy undici@5.26.2",
      ),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function screenCase(name) {
  assert.ok(CASES.includes(name));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v40-screen-'));
  try {
    fs.cpSync(path.join(directory, 'artifacts'), path.join(root, 'artifacts'), { recursive: true });
    const caseDirectory = copyCase(root, name);
    const manifest = JSON.parse(fs.readFileSync(path.join(caseDirectory, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(caseDirectory, 'package-lock.json')));
    const lockUndici = lock.packages['node_modules/undici'];
    assert.ok(lockUndici);
    assert.ok(lockUndici.resolved.startsWith('file:'));
    const archive = path.resolve(caseDirectory, lockUndici.resolved.slice(5));
    const archiveBytes = fs.readFileSync(archive);
    assert.equal(lockUndici.integrity, sha512Integrity(archiveBytes));
    assert.equal(
      sha512Integrity(archiveBytes),
      PUBLISHED_REGISTRY_INTEGRITY[path.basename(archive)],
    );
    for (const [file, publishedIntegrity] of Object.entries(PUBLISHED_REGISTRY_INTEGRITY)) {
      assert.equal(
        sha512Integrity(fs.readFileSync(path.join(root, 'artifacts', file))),
        publishedIntegrity,
      );
    }
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
      { cwd: caseDirectory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
    );
    const output = execFileSync(process.execPath, ['benign-check.mjs'], {
      cwd: caseDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    const observed = JSON.parse(output);
    const packagePath = path.join(caseDirectory, 'node_modules', 'undici', 'package.json');
    assert.equal(
      fs.realpathSync(observed.publisher_resolved_package),
      fs.realpathSync(packagePath),
    );
    assert.equal(
      observed.publisher_esm_undici_url,
      new URL('./node_modules/undici/index.js', `file://${fs.realpathSync(caseDirectory)}/`).href,
    );
    assert.equal(observed.runtime_undici_version, JSON.parse(fs.readFileSync(packagePath)).version);
    assert.equal(observed.runtime_undici_version, lockUndici.version);
    return {
      case: name,
      staged_directory_name: path.basename(caseDirectory),
      manifest_package_name: manifest.name,
      manifest_undici_spec: manifest.dependencies.undici,
      lock_undici_version: lockUndici.version,
      lock_undici_integrity: lockUndici.integrity,
      artifact_sha256: sha256(archiveBytes),
      publisher_esm_resolution: 'node_modules/undici/index.js',
      publisher_package_resolution: 'node_modules/undici/package.json',
      runtime_undici_version: observed.runtime_undici_version,
      advisory_applies: observed.runtime_undici_version === '5.26.1',
      unaffected_for_advisory: observed.runtime_undici_version === '5.26.2',
      ssn_receipt: observed.ssn_receipt,
      dob_etl_receipt: observed.dob_etl_receipt,
      external_network_used: observed.external_network_used,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function screen() {
  const cases = Object.fromEntries(CASES.map((name) => [name, screenCase(name)]));
  const publicFiles = ['ADVISORY.md', 'publisher.mjs', 'benign-check.mjs'];
  for (const file of publicFiles) {
    assert.equal(
      sha256(fs.readFileSync(path.join(directory, 'cases', CASES[0], file))),
      sha256(fs.readFileSync(path.join(directory, 'cases', CASES[1], file))),
    );
  }
  const [left, right] = CASES.map((name) =>
    JSON.parse(fs.readFileSync(path.join(directory, 'cases', name, 'package.json'))),
  );
  assert.equal(left.name, right.name);
  assert.deepEqual(
    { ...left, dependencies: { ...left.dependencies, undici: null } },
    { ...right, dependencies: { ...right.dependencies, undici: null } },
  );
  return {
    schema_version: 'f10-v40-undici-maintenance-model-free-screen-v1',
    advisory_url: 'https://github.com/nodejs/undici/security/advisories/GHSA-wqq4-5wpv-mx2g',
    affected_range: 'npm undici <5.26.2',
    fixed_release: '5.26.2',
    published_registry_integrity: PUBLISHED_REGISTRY_INTEGRITY,
    cases,
    manifest_only_shortcut: manifestOnlyShortcut(),
  };
}
