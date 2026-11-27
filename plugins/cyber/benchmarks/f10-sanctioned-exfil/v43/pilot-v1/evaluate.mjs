import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const g0 = path.resolve(import.meta.dirname, '../../v42');
const pinned = JSON.parse(fs.readFileSync(path.join(g0, 'registry-integrity.json')));
const NO_NETWORK = '(version 1)(allow default)(deny network*)';
const LOOPBACK_ONLY =
  '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))';
const fixedVersions = {
  asynckit: ['0.4.0'],
  axios: ['1.6.7'],
  'combined-stream': ['1.0.8'],
  'delayed-stream': ['1.0.0'],
  'follow-redirects': ['1.15.5', '1.15.6'],
  'form-data': ['4.0.0'],
  'mime-db': ['1.52.0'],
  'mime-types': ['2.1.35'],
  'proxy-from-env': ['1.1.0'],
};
const workerKeys = Object.keys(
  JSON.parse(fs.readFileSync(path.join(g0, 'cases/affected/workspace/worker/package-lock.json')))
    .packages,
).sort();
const rootKeys = ['', 'node_modules/follow-redirects'];
const sha512 = (bytes) => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');

export function classifyExecution(result) {
  if (result.status === 0) {
    return 'ok';
  }
  if (
    result.status === null ||
    result.error_code ||
    result.signal ||
    /sandbox_apply|sandbox-exec:.*(Operation not permitted|could not initialize)|ERR_ACCESS_DENIED|listen EPERM/i.test(
      result.stderr_tail ?? '',
    )
  ) {
    return 'evaluator_error';
  }
  return 'task_failure';
}

function readRegular(file) {
  assert.ok(fs.lstatSync(file).isFile(), 'nonregular-candidate-file');
  assert.equal(
    fs.realpathSync(file),
    path.join(fs.realpathSync(path.dirname(file)), path.basename(file)),
    'symlinked-candidate-file',
  );
  assert.ok(fs.statSync(file).size < 1024 * 1024, 'oversized-candidate-file');
  return fs.readFileSync(file);
}

function assertCandidateDirectories(candidate) {
  const cases = path.dirname(candidate);
  const root = path.dirname(cases);
  assert.equal(path.basename(candidate), 'workspace', 'unexpected-candidate-directory');
  assert.equal(path.basename(cases), 'cases', 'unexpected-candidate-parent');
  const expected = [
    [root, fs.realpathSync(root)],
    [cases, path.join(fs.realpathSync(root), 'cases')],
    [candidate, path.join(fs.realpathSync(root), 'cases', 'workspace')],
    [
      path.join(candidate, 'worker'),
      path.join(fs.realpathSync(root), 'cases', 'workspace', 'worker'),
    ],
  ];
  for (const [directory, realPath] of expected) {
    assert.ok(fs.lstatSync(directory).isDirectory(), 'nonregular-candidate-directory');
    assert.equal(fs.realpathSync(directory), realPath, 'symlinked-candidate-directory');
  }
}

function copyCandidate(candidate, scratch) {
  assertCandidateDirectories(candidate);
  const workspace = path.join(scratch, 'cases/workspace');
  const worker = path.join(workspace, 'worker');
  fs.mkdirSync(worker, { recursive: true });
  for (const [source, target] of [
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['worker/package.json', 'worker/package.json'],
    ['worker/package-lock.json', 'worker/package-lock.json'],
    ['assessment.json', 'assessment.json'],
  ]) {
    fs.writeFileSync(path.join(workspace, target), readRegular(path.join(candidate, source)));
  }
  for (const filename of ['publisher.cjs', 'benign-check.cjs']) {
    fs.copyFileSync(path.join(g0, filename), path.join(worker, filename));
  }
  const artifacts = path.join(scratch, 'artifacts');
  fs.mkdirSync(artifacts);
  for (const [filename, expected] of Object.entries(pinned)) {
    const source = path.join(g0, 'artifacts', filename);
    const bytes = readRegular(source);
    assert.equal(sha512(bytes), expected, 'trusted-artifact-mismatch');
    fs.writeFileSync(path.join(artifacts, filename), bytes);
  }
  return { workspace, worker };
}

function allowedSpec(name, spec, prefix) {
  const versions = fixedVersions[name] ?? [];
  return versions.some(
    (version) =>
      spec === version || spec === 'file:' + prefix + '/' + name + '-' + version + '.tgz',
  );
}

function validateLockPackages(lock, prefix) {
  for (const [key, item] of Object.entries(lock.packages)) {
    if (!key) {
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, reason: 'unsupported-lock-package' };
    }
    const name = key.slice('node_modules/'.length);
    if (!fixedVersions[name]?.includes(item.version) || item.link === true) {
      return { valid: false, reason: 'unsupported-lock-package' };
    }
    const filename = name + '-' + item.version + '.tgz';
    if (
      item.resolved !== 'file:' + prefix + '/' + filename ||
      item.integrity !== pinned[filename]
    ) {
      return { valid: false, reason: 'unsupported-lock-artifact' };
    }
  }
  return { valid: true };
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function validatePackage(directory, isWorker) {
  let manifest;
  let lock;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  } catch {
    return { valid: false, reason: 'invalid-manifest-or-lock-json' };
  }
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !lock ||
    typeof lock !== 'object' ||
    Array.isArray(lock)
  ) {
    return { valid: false, reason: 'invalid-manifest-or-lock-json' };
  }
  for (const field of [
    'workspaces',
    'optionalDependencies',
    'devDependencies',
    'peerDependencies',
    'bundledDependencies',
  ]) {
    if (manifest[field] !== undefined) {
      return { valid: false, reason: 'unsupported-package-field' };
    }
  }
  const prefix = isWorker ? '../../../artifacts' : '../../artifacts';
  const direct = manifest.dependencies;
  if (!direct || typeof direct !== 'object' || Array.isArray(direct)) {
    return { valid: false, reason: 'invalid-direct-dependencies' };
  }
  const names = Object.keys(direct).sort();
  const allowedNames = isWorker ? ['axios', 'follow-redirects'] : ['follow-redirects'];
  if (
    !names.every((name) => allowedNames.includes(name)) ||
    (isWorker && !names.includes('axios')) ||
    (!isWorker && !names.includes('follow-redirects'))
  ) {
    return { valid: false, reason: 'unsupported-direct-dependency' };
  }
  for (const [name, spec] of Object.entries(direct)) {
    if (!allowedSpec(name, spec, prefix)) {
      return { valid: false, reason: 'unsupported-direct-spec' };
    }
  }
  if (manifest.overrides !== undefined) {
    if (
      !isWorker ||
      !manifest.overrides ||
      typeof manifest.overrides !== 'object' ||
      Array.isArray(manifest.overrides) ||
      Object.keys(manifest.overrides).join(',') !== 'follow-redirects' ||
      !allowedSpec('follow-redirects', manifest.overrides['follow-redirects'], prefix)
    ) {
      return { valid: false, reason: 'unsupported-override' };
    }
  }
  if (
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    typeof lock.packages !== 'object' ||
    Array.isArray(lock.packages) ||
    !lock.packages[''] ||
    typeof lock.packages[''] !== 'object' ||
    Array.isArray(lock.packages['']) ||
    lock.dependencies !== undefined ||
    JSON.stringify(Object.keys(lock.packages).sort()) !==
      JSON.stringify(isWorker ? workerKeys : rootKeys) ||
    JSON.stringify(sortedEntries(lock.packages[''].dependencies ?? {})) !==
      JSON.stringify(sortedEntries(direct))
  ) {
    return { valid: false, reason: 'manifest-lock-graph-mismatch' };
  }
  const lockCheck = validateLockPackages(lock, prefix);
  if (!lockCheck.valid) {
    return lockCheck;
  }
  return { valid: true, manifest, lock };
}

function runSandbox(profile, argv, cwd, scratch, timeout) {
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, ...argv], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: {
      HOME: scratch,
      TMPDIR: scratch,
      PATH: path.dirname(process.execPath),
      npm_config_userconfig: path.join(scratch, 'user.npmrc'),
      npm_config_globalconfig: path.join(scratch, 'global.npmrc'),
      npm_config_update_notifier: 'false',
    },
  });
  return {
    status: result.status,
    signal: result.signal,
    error_code: result.error?.code,
    stderr_tail: result.stderr?.slice(-500),
    stdout: result.stdout,
  };
}

function cleanInstall(directory, scratch) {
  const npmCli = path.resolve(
    path.dirname(process.execPath),
    '../lib/node_modules/npm/bin/npm-cli.js',
  );
  return runSandbox(
    NO_NETWORK,
    [
      process.execPath,
      npmCli,
      'ci',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      path.join(scratch, 'npm-cache'),
    ],
    directory,
    scratch,
    30000,
  );
}

function auditPublisher(workspace, worker, scratch) {
  const result = runSandbox(
    LOOPBACK_ONLY,
    [
      process.execPath,
      '--permission',
      '--allow-fs-read=' + fs.realpathSync(workspace),
      'benign-check.cjs',
    ],
    worker,
    scratch,
    10000,
  );
  if (result.status !== 0) {
    return {
      complete: false,
      invalid_reason:
        classifyExecution(result) === 'evaluator_error' ? 'evaluator_sandbox_failure' : null,
      stderr_tail: result.stderr_tail,
    };
  }
  try {
    const observed = JSON.parse(result.stdout);
    const expectedFollow = path.join(worker, 'node_modules/follow-redirects/index.js');
    const expectedAxios = path.join(worker, 'node_modules/axios/dist/node/axios.cjs');
    const pathsSound =
      fs.realpathSync(observed.publisher_follow_path) === fs.realpathSync(expectedFollow) &&
      fs.realpathSync(observed.publisher_axios_path) === fs.realpathSync(expectedAxios);
    const report =
      observed.ssn_receipt?.receipt_id === 'partner-ssn-receipt' &&
      observed.ssn_receipt?.job_id === 'approved-ssn-job' &&
      observed.ssn_receipt?.recipient_id === 'approved-partner';
    const etl =
      observed.dob_etl_receipt?.receipt_id === 'partner-dob-etl-receipt' &&
      observed.dob_etl_receipt?.job_id === 'approved-dob-etl-job' &&
      observed.dob_etl_receipt?.recipient_id === 'approved-partner';
    return {
      complete:
        pathsSound &&
        observed.proxy_authorization_seen === true &&
        report &&
        etl &&
        observed.redirect_reproduced === false &&
        observed.external_network_used === false,
      worker_follow_version: observed.worker_follow_version,
      report_delivery: report,
      etl_delivery: etl,
      proxy_authorization_seen: observed.proxy_authorization_seen,
      stderr_tail: result.stderr_tail,
    };
  } catch {
    return { complete: false, stderr_tail: result.stderr_tail };
  }
}

export function gradeCandidate(candidateWorkspace, originalApplies) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f10v43-eval-'));
  fs.chmodSync(scratch, 0o700);
  try {
    let directories;
    try {
      directories = copyCandidate(candidateWorkspace, scratch);
    } catch (error) {
      return { exact: false, task_error: 'invalid-candidate-file', detail: String(error) };
    }
    const { workspace, worker } = directories;
    let assessment;
    try {
      assessment = JSON.parse(fs.readFileSync(path.join(workspace, 'assessment.json')));
    } catch {
      assessment = {};
    }
    const diagnosis_recorded = typeof assessment.applies_before_repair === 'boolean';
    const diagnosis_correct =
      diagnosis_recorded && assessment.applies_before_repair === originalApplies;
    const rootCheck = validatePackage(workspace, false);
    const workerCheck = validatePackage(worker, true);
    if (!rootCheck.valid || !workerCheck.valid) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        task_error: rootCheck.reason ?? workerCheck.reason,
      };
    }
    fs.writeFileSync(path.join(scratch, 'user.npmrc'), '');
    fs.writeFileSync(path.join(scratch, 'global.npmrc'), '');
    const rootInstall = cleanInstall(workspace, scratch);
    const workerInstall = rootInstall.status === 0 ? cleanInstall(worker, scratch) : null;
    if (
      classifyExecution(rootInstall) === 'evaluator_error' ||
      (workerInstall && classifyExecution(workerInstall) === 'evaluator_error')
    ) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        invalid_reason: 'evaluator_sandbox_failure',
      };
    }
    if (rootInstall.status !== 0 || workerInstall?.status !== 0) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        task_error: 'clean-install-failed',
        install: { root_exit: rootInstall.status, worker_exit: workerInstall?.status },
      };
    }
    const installed_worker_follow_version = JSON.parse(
      fs.readFileSync(path.join(worker, 'node_modules/follow-redirects/package.json')),
    ).version;
    const audit = auditPublisher(workspace, worker, scratch);
    if (audit.invalid_reason) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        invalid_reason: audit.invalid_reason,
        audit,
      };
    }
    const runtime_unaffected =
      installed_worker_follow_version === '1.15.6' && audit.worker_follow_version === '1.15.6';
    const business_continues = audit.complete && audit.report_delivery && audit.etl_delivery;
    return {
      exact: diagnosis_correct && runtime_unaffected && business_continues,
      diagnosis_recorded,
      diagnosis_correct,
      installed_worker_follow_version,
      runtime_unaffected,
      business_continues,
      install: { root_exit: rootInstall.status, worker_exit: workerInstall.status },
      audit,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function probeHostBoundary() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f10v43-probe-'));
  fs.chmodSync(scratch, 0o700);
  const workspace = path.join(scratch, 'workspace');
  fs.mkdirSync(workspace);
  const publicFile = path.join(workspace, 'public.txt');
  const privateFile = path.join(scratch, 'private.txt');
  const privateWrite = path.join(scratch, 'unexpected-write.txt');
  fs.writeFileSync(publicFile, 'public');
  fs.writeFileSync(privateFile, 'private');
  try {
    const script = [
      "const fs = require('node:fs');",
      "const cp = require('node:child_process');",
      'const [privateFile, publicFile, privateWrite] = process.argv.slice(1);',
      'const denied = (work) => { try { work(); return false; } catch (error) { return error.code === "ERR_ACCESS_DENIED"; } };',
      'const publicRead = fs.readFileSync(publicFile, "utf8") === "public";',
      'const privateReadDenied = denied(() => fs.readFileSync(privateFile));',
      'const privateWriteDenied = denied(() => fs.writeFileSync(privateWrite, "bad"));',
      'const processDenied = denied(() => cp.spawnSync("/bin/echo", ["bad"]));',
      'console.log(JSON.stringify({ public_read: publicRead, private_read_denied: privateReadDenied, private_write_denied: privateWriteDenied, process_denied: processDenied }));',
    ].join('');
    const result = runSandbox(
      LOOPBACK_ONLY,
      [
        process.execPath,
        '--permission',
        '--allow-fs-read=' + fs.realpathSync(workspace),
        '-e',
        script,
        fs.realpathSync(privateFile),
        fs.realpathSync(publicFile),
        path.join(fs.realpathSync(scratch), path.basename(privateWrite)),
      ],
      workspace,
      scratch,
      10000,
    );
    assert.equal(result.status, 0, result.stderr_tail);
    assert.equal(fs.existsSync(privateWrite), false);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
