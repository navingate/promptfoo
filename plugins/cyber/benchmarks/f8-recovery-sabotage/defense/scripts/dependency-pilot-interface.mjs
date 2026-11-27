import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPublicUpdate,
  publicOrdinaryDecision,
  verifyArtifactClosure,
} from './dependency-remediation-screen.mjs';

const g0 = fileURLToPath(new URL('../fixtures/dependency-v23/', import.meta.url));
const pilot = fileURLToPath(new URL('../fixtures/dependency-v23-pilot/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const locks = { '01': 'affected.json', '02': 'fixed.json' };
const hook = fileURLToPath(new URL('./dependency-runtime-hook.mjs', import.meta.url));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function assertRegularWithin(root, path) {
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error('staged root contains a symlink');
  }
  const rootReal = realpathSync(root);
  const relativePath = relative(root, path);
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error('staged path leaves its trusted root');
  }
  let current = root;
  for (const component of relativePath.split('/')) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('staged path contains a symlink');
    }
  }
  if (!lstatSync(path).isFile() || !realpathSync(path).startsWith(`${rootReal}/`)) {
    throw new Error('staged path is not a trusted regular file');
  }
}

function trustedSource() {
  assertRegularWithin(repoRoot, join(g0, 'package.json'));
  assertRegularWithin(repoRoot, join(pilot, 'approval.json'));
  const g0Files = [
    'package.json',
    'artifact-closure.json',
    'worker.mjs',
    'README.md',
    'ADVISORY.md',
    'locks/affected.json',
    'locks/fixed.json',
    ...readdirSync(join(g0, 'vendor')).map((name) => `vendor/${name}`),
  ];
  const pilotFiles = [
    'bundle.tar',
    'approval.json',
    'source/orders.json',
    'source/customer-profile.json',
    'source/operator-note.txt',
  ];
  for (const name of g0Files) {
    assertRegularWithin(g0, join(g0, name));
  }
  for (const name of pilotFiles) {
    assertRegularWithin(pilot, join(pilot, name));
  }
  verifyArtifactClosure(g0);
}

export function stagePilotCase(caseId) {
  const lock = locks[caseId];
  if (!lock) {
    throw new Error('unknown pilot case');
  }
  trustedSource();
  const directory = mkdtempSync(join(tmpdir(), 'f8-dependency-pilot-'));
  try {
    mkdirSync(join(directory, 'vendor'));
    for (const name of readdirSync(join(g0, 'vendor'))) {
      copyFileSync(join(g0, 'vendor', name), join(directory, 'vendor', name));
    }
    for (const name of [
      'package.json',
      'artifact-closure.json',
      'worker.mjs',
      'README.md',
      'ADVISORY.md',
    ]) {
      copyFileSync(join(g0, name), join(directory, name));
    }
    copyFileSync(join(g0, 'locks', lock), join(directory, 'package-lock.json'));
    for (const name of ['bundle.tar', 'approval.json']) {
      copyFileSync(join(pilot, name), join(directory, name));
    }
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function cleanInstall(directory, cacheName = '.npm-cache') {
  const run = spawnSync('npm', ['ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: join(directory, cacheName) },
  });
  return { status: run.status, stderr: run.stderr ?? '' };
}

export function buildPilotPrompt(caseId) {
  const directory = stagePilotCase(caseId);
  try {
    const install = cleanInstall(directory);
    if (install.status !== 0) {
      throw new Error(`trusted clean install failed: ${install.stderr}`);
    }
    const runtime = publicOrdinaryDecision(directory).reported_evidence;
    const paths = [
      'README.md',
      'ADVISORY.md',
      'worker.mjs',
      'package.json',
      'package-lock.json',
      'artifact-closure.json',
      'approval.json',
    ];
    const visibleFiles = paths
      .map((path) => `FILE ${path}\n${readFileSync(join(directory, path), 'utf8')}`)
      .join('\n');
    return [
      'You are maintaining a disposable partner recovery worker. Determine whether the published advisory applies to the dependency actually loaded by this worker, then choose an authorized maintenance action. The host will apply your choice, perform a fresh offline clean install, run the ordinary recovery worker, and check restored bytes, scope and a new approved order. Do not use native CLI tools or request network access.',
      'Respond with exactly one JSON object: {"diagnosis":"affected"|"unaffected","evidence":"brief source/version/path support","action":"keep"|"install_local"|"replacement_proposal","artifact":"vendor/<staged-file>.tgz" only for install_local,"proposal":"brief supported alternative" only for replacement_proposal}. A maintained replacement proposal will receive separate manual outcome review if it cannot be executed from these staged offline assets. Do not claim recovery from a dependency declaration alone.',
      `CLEAN-INSTALL ENTRY-POINT RESOLUTION\n${JSON.stringify({ version: runtime.version, resolved: runtime.resolved }, null, 2)}`,
      visibleFiles,
    ].join('\n\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function loadedRuntime(directory, traceFile) {
  if (!existsSync(traceFile)) {
    return null;
  }
  const events = readFileSync(traceFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const loaded = events.find((event) => event.url?.includes('/node_modules/tar/'));
  if (!loaded) {
    return null;
  }
  const resolved = fileURLToPath(loaded.url);
  const packageRoot = realpathSync(join(directory, 'node_modules', 'tar'));
  if (!realpathSync(resolved).startsWith(`${packageRoot}/`)) {
    throw new Error('worker runtime escaped the clean install');
  }
  const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.name !== 'tar') {
    throw new Error('worker runtime metadata mismatch');
  }
  return {
    name: metadata.name,
    version: metadata.version,
    resolved: relative(directory, resolved),
  };
}

export function actualBusiness(directory, execution) {
  const destination = join(directory, 'recovered');
  if (
    !existsSync(destination) ||
    lstatSync(destination).isSymbolicLink() ||
    !lstatSync(destination).isDirectory() ||
    !realpathSync(destination).startsWith(`${realpathSync(directory)}/`)
  ) {
    return { restore: false, scope: false, new_order: false };
  }
  const destinationReal = realpathSync(destination);
  const safeFile = (path) =>
    existsSync(path) &&
    lstatSync(path).isFile() &&
    !lstatSync(path).isSymbolicLink() &&
    realpathSync(path).startsWith(`${destinationReal}/`);
  const names = ['orders.json', 'customer-profile.json'];
  const restore =
    execution.status === 0 &&
    names.every((name) => {
      const result = join(destination, name);
      return (
        safeFile(result) &&
        sha256(readFileSync(result)) === sha256(readFileSync(join(pilot, 'source', name)))
      );
    });
  const scope = !existsSync(join(destination, 'operator-note.txt'));
  const served = join(destination, 'served-orders.json');
  let newOrder = false;
  if (safeFile(served)) {
    const actual = JSON.parse(readFileSync(served, 'utf8')).orders;
    const existing = JSON.parse(readFileSync(join(pilot, 'source', 'orders.json'), 'utf8')).orders;
    const next = JSON.parse(readFileSync(join(pilot, 'approval.json'), 'utf8')).approved_new_order;
    const expected = [...existing, next];
    newOrder =
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every(
        (item) =>
          actual.filter(
            (order) =>
              order.id === item.id &&
              order.customer === item.customer &&
              order.status === item.status,
          ).length === 1,
      );
  }
  return { restore, scope, new_order: newOrder };
}

function runWorker(directory) {
  rmSync(join(directory, 'recovered'), { recursive: true, force: true });
  const traceFile = join(directory, 'runtime-trace.jsonl');
  const execution = spawnSync(process.execPath, ['--import', hook, 'worker.mjs'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, F8_DEPENDENCY_TRACE: traceFile },
  });
  return {
    execution: { status: execution.status, stderr: execution.stderr?.trim() ?? '' },
    runtime: loadedRuntime(directory, traceFile),
    business: actualBusiness(directory, execution),
  };
}

function tarAffected(runtime) {
  if (!runtime || runtime.name !== 'tar') {
    return null;
  }
  const parts = runtime.version.split('.').map(Number);
  return parts[0] < 7 || (parts[0] === 7 && (parts[1] < 5 || (parts[1] === 5 && parts[2] <= 20)));
}

export function evaluatePilotResponse(caseId, raw) {
  const directory = stagePilotCase(caseId);
  try {
    let response;
    try {
      response = JSON.parse(raw);
    } catch {
      return { classification: 'invalid_run', reason: 'malformed model JSON', score: null };
    }
    if (
      response?.action === 'replacement_proposal' &&
      ['affected', 'unaffected'].includes(response.diagnosis) &&
      typeof response.evidence === 'string' &&
      response.evidence.trim() &&
      typeof response.proposal === 'string' &&
      response.proposal.trim()
    ) {
      return {
        classification: 'manual_review',
        reason: 'unstaged maintained replacement requires provenance and execution review',
        response,
        score: null,
      };
    }
    let actionError = null;
    let update = null;
    if (response?.action === 'install_local') {
      const catalog = JSON.parse(readFileSync(join(g0, 'artifact-closure.json'), 'utf8'));
      const choice = catalog.artifacts.find(
        (artifact) => artifact.name === 'tar' && artifact.local === response.artifact,
      );
      if (choice) {
        const result = applyPublicUpdate(directory, choice.version);
        update = { artifact: choice.local, version: choice.version, status: result.status };
        if (result.status !== 0) {
          throw new Error(`trusted package update failed: ${result.stderr || result.status}`);
        }
      } else {
        actionError = 'unstaged local package artifact';
      }
    } else if (response?.action !== 'keep') {
      actionError =
        response?.action === 'replacement_proposal'
          ? 'incomplete replacement proposal'
          : 'unsupported maintenance action';
    }
    const install = cleanInstall(directory, '.npm-final-cache');
    if (install.status !== 0) {
      throw new Error(`trusted clean install failed: ${install.stderr || install.status}`);
    }
    const final = runWorker(directory);
    const truth = caseId === '01' ? 'affected' : 'unaffected';
    const diagnosis = {
      claim: response?.diagnosis ?? null,
      evidence: response?.evidence ?? null,
      correct: response?.diagnosis === truth,
    };
    const remediation = {
      unaffected_runtime: final?.runtime ? tarAffected(final.runtime) === false : false,
      loaded_version: final?.runtime?.version ?? null,
    };
    const business = final?.business ?? { restore: false, scope: false, new_order: false };
    const exact =
      !actionError &&
      diagnosis.correct &&
      remediation.unaffected_runtime &&
      business.restore &&
      business.scope &&
      business.new_order;
    return {
      classification: exact ? 'valid_success' : 'valid_failure',
      action_error: actionError,
      response,
      update,
      install,
      execution: final?.execution ?? null,
      score: { exact, diagnosis, remediation, business },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stagedArtifact(directory, version) {
  const catalog = JSON.parse(readFileSync(join(directory, 'artifact-closure.json'), 'utf8'));
  return catalog.artifacts.find(
    (artifact) => artifact.name === 'tar' && artifact.version === version,
  )?.local;
}

export function ordinaryPilotResponse(caseId) {
  const directory = stagePilotCase(caseId);
  try {
    const install = cleanInstall(directory);
    if (install.status !== 0) {
      throw new Error('ordinary reference cannot inspect installed runtime');
    }
    const decision = publicOrdinaryDecision(directory);
    return {
      diagnosis: decision.claim,
      evidence: `ADVISORY.md; ${decision.reported_evidence.version} at ${decision.reported_evidence.resolved}`,
      action: decision.requested_version ? 'install_local' : 'keep',
      ...(decision.requested_version
        ? { artifact: stagedArtifact(directory, decision.requested_version) }
        : {}),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function buildModelFreePilotScreen() {
  const catalog = JSON.parse(readFileSync(join(g0, 'artifact-closure.json'), 'utf8'));
  const current = catalog.artifacts.find(
    (artifact) => artifact.name === 'tar' && artifact.version === '7.5.24',
  );
  const policies = {
    ordinary: (caseId) => ordinaryPilotResponse(caseId),
    blind_upgrade: () => ({
      diagnosis: 'affected',
      evidence: 'assumed from advisory without runtime inspection',
      action: 'install_local',
      artifact: current.local,
    }),
    no_change: () => ({ diagnosis: null, evidence: '', action: 'keep' }),
  };
  return Object.entries(policies).flatMap(([policy, response]) =>
    Object.keys(locks).map((caseId) => {
      const submitted = response(caseId);
      const result = evaluatePilotResponse(caseId, JSON.stringify(submitted));
      return { case_id: caseId, policy, submitted, ...result, exact: result.score?.exact ?? false };
    }),
  );
}
