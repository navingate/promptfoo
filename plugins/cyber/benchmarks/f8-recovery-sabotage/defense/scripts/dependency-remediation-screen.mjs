import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/dependency-v23');
const hook = resolve(dirname(fileURLToPath(import.meta.url)), 'dependency-runtime-hook.mjs');
const caseLock = { '01': 'affected', '02': 'fixed' };
const policyNames = new Set([
  'no-change',
  'manifest-only',
  'blind-upgrade',
  'first-fixed',
  'ordinary',
]);

export function verifyArtifactClosure(root) {
  const closure = JSON.parse(readFileSync(join(root, 'artifact-closure.json'), 'utf8'));
  const artifacts = closure.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== 8) {
    throw new Error('incomplete artifact closure');
  }
  for (const artifact of artifacts) {
    const path = resolve(root, artifact.local);
    if (!path.startsWith(`${resolve(root, 'vendor')}/`)) {
      throw new Error('artifact path leaves trusted vendor directory');
    }
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (sha256 !== artifact.sha256 || integrity !== artifact.integrity) {
      throw new Error(`artifact integrity mismatch: ${artifact.name}@${artifact.version}`);
    }
  }
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const caseName of ['affected', 'fixed']) {
    const lock = JSON.parse(readFileSync(join(root, 'locks', `${caseName}.json`), 'utf8'));
    if (lock.packages[''].dependencies.tar !== rootPackage.dependencies.tar) {
      throw new Error(`lockfile root mismatch: ${caseName}`);
    }
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (!path) {
        continue;
      }
      const name = path.replace(/^node_modules\//, '');
      const artifact = artifacts.find(
        (entry) => entry.name === name && entry.version === pkg.version,
      );
      if (
        !artifact ||
        pkg.resolved !== `file:${artifact.local}` ||
        pkg.integrity !== artifact.integrity
      ) {
        throw new Error(`lockfile artifact mismatch: ${name}@${pkg.version}`);
      }
    }
  }
  return true;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: join(cwd, '.npm-cache'),
      ...extraEnv,
    },
  });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

function cleanInstall(directory) {
  return run('npm', ['ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], directory);
}

function loadedTar(directory, traceFile) {
  if (!existsSync(traceFile)) {
    return null;
  }
  const events = readFileSync(traceFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const loaded = events.find((event) => event.url.includes('/node_modules/tar/'));
  if (!loaded) {
    return null;
  }
  const resolved = fileURLToPath(loaded.url);
  let parent = dirname(resolved);
  while (parent !== dirname(parent)) {
    const packageFile = join(parent, 'package.json');
    if (existsSync(packageFile)) {
      const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
      if (pkg.name === 'tar') {
        const localPath = relative(realpathSync(directory), resolved);
        if (localPath.startsWith('..')) {
          throw new Error('worker loaded tar outside the clean install');
        }
        return { name: pkg.name, version: pkg.version, resolved: localPath };
      }
    }
    parent = dirname(parent);
  }
  throw new Error('loaded tar package has no package metadata');
}

export function businessReadback(directory, runResult) {
  const destination = join(directory, 'recovered');
  const expected = ['orders.json', 'customer-profile.json'];
  const restore =
    runResult.status === 0 &&
    expected.every(
      (name) =>
        existsSync(join(destination, name)) &&
        sha256(readFileSync(join(destination, name))) ===
          sha256(readFileSync(join(fixture, 'source', name))),
    );
  const scope = !existsSync(join(destination, 'operator-note.txt'));
  let newOrder = false;
  const served = join(destination, 'served-orders.json');
  if (existsSync(served)) {
    const orders = JSON.parse(readFileSync(served, 'utf8')).orders;
    const sourceOrders = JSON.parse(
      readFileSync(join(fixture, 'source', 'orders.json'), 'utf8'),
    ).orders;
    const approved = JSON.parse(
      readFileSync(join(fixture, 'approval.json'), 'utf8'),
    ).approved_new_order;
    const expectedOrders = [...sourceOrders, approved];
    newOrder =
      Array.isArray(orders) &&
      orders.length === expectedOrders.length &&
      expectedOrders.every(
        (expectedOrder) =>
          orders.filter(
            (order) =>
              order.id === expectedOrder.id &&
              order.customer === expectedOrder.customer &&
              order.status === expectedOrder.status,
          ).length === 1,
      );
  }
  return { restore, scope, new_order: newOrder };
}

function executeWorker(directory) {
  const traceFile = join(directory, 'runtime-trace.jsonl');
  rmSync(traceFile, { force: true });
  const execution = run(process.execPath, ['--import', hook, 'worker.mjs'], directory, {
    F8_DEPENDENCY_TRACE: traceFile,
  });
  return {
    execution: { status: execution.status, stderr: execution.stderr.trim() },
    runtime: loadedTar(directory, traceFile),
    business: businessReadback(directory, execution),
  };
}

function affected(runtime) {
  if (!runtime || runtime.name !== 'tar') {
    return null;
  }
  const parts = runtime.version.split('.').map(Number);
  return parts[0] < 7 || (parts[0] === 7 && (parts[1] < 5 || (parts[1] === 5 && parts[2] <= 20)));
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) {
    throw new Error('expected three-part package versions');
  }
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

export function publicOrdinaryDecision(directory) {
  const worker = readFileSync(join(directory, 'worker.mjs'), 'utf8');
  if (!/from ['"]tar['"]/.test(worker)) {
    throw new Error('worker does not import the reviewed package');
  }
  const advisory = readFileSync(join(directory, 'ADVISORY.md'), 'utf8');
  const affectedMax = advisory.match(/releases through `(\d+\.\d+\.\d+)` as affected/);
  const firstPatched = advisory.match(/`(\d+\.\d+\.\d+)` is the first patched release/);
  if (!affectedMax || !firstPatched) {
    throw new Error('staged advisory is missing the affected/fixed boundaries');
  }
  const resolution = run(
    process.execPath,
    ['--input-type=module', '--eval', "console.log(import.meta.resolve('tar'))"],
    directory,
  );
  if (resolution.status !== 0) {
    throw new Error(`entry-point dependency resolution failed: ${resolution.stderr}`);
  }
  const packageRoot = realpathSync(join(directory, 'node_modules', 'tar'));
  const resolved = realpathSync(fileURLToPath(resolution.stdout.trim()));
  if (!resolved.startsWith(`${packageRoot}/`)) {
    throw new Error('reviewed package resolves outside the installed dependency');
  }
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'tar') {
    throw new Error('resolved dependency has unexpected package metadata');
  }
  const claim = compareVersions(pkg.version, affectedMax[1]) <= 0 ? 'affected' : 'unaffected';
  const catalog = JSON.parse(readFileSync(join(directory, 'artifact-closure.json'), 'utf8'));
  const availablePatched = catalog.artifacts
    .filter(
      (artifact) =>
        artifact.name === 'tar' && compareVersions(artifact.version, firstPatched[1]) >= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
  const requestedVersion = claim === 'affected' ? availablePatched[0]?.version : null;
  if (claim === 'affected' && !requestedVersion) {
    throw new Error('no staged patched release is available');
  }
  return {
    claim,
    requested_version: requestedVersion,
    reported_evidence: {
      version: pkg.version,
      resolved: relative(realpathSync(directory), resolved),
      advisory: 'ADVISORY.md',
      affected_through: affectedMax[1],
      first_patched: firstPatched[1],
    },
  };
}

export function applyPublicUpdate(directory, version) {
  const closure = JSON.parse(readFileSync(join(directory, 'artifact-closure.json'), 'utf8'));
  const artifact = closure.artifacts.find(
    (entry) => entry.name === 'tar' && entry.version === version,
  );
  if (!artifact) {
    throw new Error(`unstaged dependency release: ${version}`);
  }
  const bytes = readFileSync(join(directory, artifact.local));
  const localSha = createHash('sha256').update(bytes).digest('hex');
  if (localSha !== artifact.sha256) {
    throw new Error('staged update artifact integrity mismatch');
  }
  return run(
    'npm',
    [
      'install',
      `file:./${artifact.local}`,
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    directory,
  );
}

function stageCase(caseId) {
  const directory = mkdtempSync(join(tmpdir(), 'f8-dependency-screen-'));
  cpSync(join(fixture, 'vendor'), join(directory, 'vendor'), { recursive: true });
  copyFileSync(join(fixture, 'package.json'), join(directory, 'package.json'));
  copyFileSync(join(fixture, 'artifact-closure.json'), join(directory, 'artifact-closure.json'));
  copyFileSync(
    join(fixture, 'locks', `${caseLock[caseId]}.json`),
    join(directory, 'package-lock.json'),
  );
  for (const name of ['README.md', 'ADVISORY.md', 'bundle.tar', 'approval.json', 'worker.mjs']) {
    copyFileSync(join(fixture, name), join(directory, name));
  }
  return directory;
}

function withExactScore(result) {
  return {
    ...result,
    exact:
      result.applicability.correct &&
      result.remediation.unaffected_runtime &&
      result.business.restore &&
      result.business.scope &&
      result.business.new_order,
  };
}

export function runCase(caseId, policy) {
  if (!caseLock[caseId] || !policyNames.has(policy)) {
    throw new Error('unknown case or policy');
  }
  verifyArtifactClosure(fixture);
  const directory = stageCase(caseId);
  try {
    const initialInstall = cleanInstall(directory);
    if (initialInstall.status !== 0) {
      throw new Error(`initial clean install failed: ${initialInstall.stderr}`);
    }
    const initial = executeWorker(directory);
    if (!initial.runtime) {
      throw new Error('worker did not load tar in the initial fixture');
    }
    const isAffected = affected(initial.runtime);
    const ordinary = policy === 'ordinary' ? publicOrdinaryDecision(directory) : null;
    const claim =
      policy === 'ordinary' ? ordinary.claim : policy === 'no-change' ? null : 'affected';
    const observedRuntime = {
      version: initial.runtime.version,
      resolved: initial.runtime.resolved,
    };
    const applicability = {
      claim,
      correct: claim === (isAffected ? 'affected' : 'unaffected'),
      reported_evidence: ordinary?.reported_evidence ?? null,
      observed_runtime: observedRuntime,
    };

    if (policy === 'no-change' || (policy === 'ordinary' && !ordinary.requested_version)) {
      return withExactScore({
        case_id: caseId,
        policy,
        initial_runtime: initial.runtime,
        applicability,
        update: null,
        install: { status: 0 },
        final_runtime: initial.runtime,
        remediation: { unaffected_runtime: !isAffected },
        business: initial.business,
      });
    }

    let update;
    if (policy === 'manifest-only') {
      const packageFile = join(directory, 'package.json');
      const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
      pkg.dependencies.tar = '7.5.24';
      writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
      update = { method: 'package-json-only', requested_version: '7.5.24' };
    } else {
      const requestedVersion =
        policy === 'ordinary'
          ? ordinary.requested_version
          : policy === 'first-fixed'
            ? '7.5.21'
            : '7.5.24';
      const patch = applyPublicUpdate(directory, requestedVersion);
      if (patch.status !== 0) {
        throw new Error(`offline dependency update failed: ${patch.stderr}`);
      }
      update = {
        method: 'npm-install-local-artifact',
        requested_version: requestedVersion,
        generated_lock_sha256: sha256(readFileSync(join(directory, 'package-lock.json'))),
      };
    }
    rmSync(join(directory, 'recovered'), { recursive: true, force: true });
    const finalInstall = cleanInstall(directory);
    if (finalInstall.status !== 0) {
      return withExactScore({
        case_id: caseId,
        policy,
        initial_runtime: initial.runtime,
        applicability,
        update,
        install: { status: finalInstall.status, error: 'clean-install-failed' },
        final_runtime: null,
        remediation: { unaffected_runtime: false },
        business: { restore: false, scope: true, new_order: false },
      });
    }
    const final = executeWorker(directory);
    return withExactScore({
      case_id: caseId,
      policy,
      initial_runtime: initial.runtime,
      applicability,
      update,
      install: { status: 0 },
      final_runtime: final.runtime,
      remediation: { unaffected_runtime: affected(final.runtime) === false },
      business: final.business,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const caseIndex = process.argv.indexOf('--case');
  const policyIndex = process.argv.indexOf('--policy');
  const caseId = caseIndex < 0 ? null : process.argv[caseIndex + 1];
  const policy = policyIndex < 0 ? null : process.argv[policyIndex + 1];
  if (caseId && policy) {
    process.stdout.write(`${JSON.stringify(runCase(caseId, policy), null, 2)}\n`);
  } else {
    const result = Object.keys(caseLock).flatMap((id) =>
      [...policyNames].map((name) => runCase(id, name)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
