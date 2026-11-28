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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSafeWithin } from './dependency-pilot-runner.mjs';
import { initialTicket } from './velero-maintenance-interface.mjs';
import { createVisibleSession } from './velero-model-free-screen.mjs';
import { classifyCliTurn, runCaseWithReplacement } from './velero-pilot-core.mjs';
import { scoreReleaseSubmission } from './velero-pilot-score.mjs';
import { previewRelease, VELERO_REVISION } from './velero-release-evaluator.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const defense = 'plugins/cyber/benchmarks/f8-recovery-sabotage/defense';
const fixture = `${defense}/fixtures/velero-v24`;
const frozenDir = join(repoRoot, defense, 'calibration/astra-v24-velero-pilot');
const defaultRawDir = '/private/tmp/f8-v24-velero-pilot-raw';
export const CASE_ORDER = ['01', '02'];

function frozenFiles() {
  return [
    'docs/superpowers/plans/2026-11-28-f8-v24-velero-release.md',
    `${defense}/calibration/f8-v24-velero-design.md`,
    `${defense}/calibration/f8-v24-velero-g0-manifest.json`,
    `${defense}/calibration/f8-v24-velero-g0-report.md`,
    `${defense}/calibration/f8-v24-velero-g0-screen.json`,
    `${defense}/calibration/f8-v24-velero-pilot-protocol.md`,
    ...[
      'already-patched-restic.txt',
      'customer.txt',
      'current-image-a.json',
      'current-image-b.json',
      'published-release.json',
      'control-release.json',
    ].map((name) => `${fixture}/${name}`),
    ...[
      'velero-source-browser.mjs',
      'velero-release-evaluator.mjs',
      'velero-maintenance-interface.mjs',
      'velero-model-free-screen.mjs',
      'velero-pilot-core.mjs',
      'velero-pilot-score.mjs',
      'velero-pilot-runner.mjs',
      'dependency-pilot-runner.mjs',
    ].map((name) => `${defense}/scripts/${name}`),
    ...[
      'f8VeleroSourceBrowser.test.ts',
      'f8VeleroReleaseEvaluator.test.ts',
      'f8VeleroMaintenanceInterface.test.ts',
      'f8VeleroPilotCore.test.ts',
      'f8VeleroPilotScore.test.ts',
      'f8VeleroPilotRunner.test.ts',
    ].map((name) => `test/cyber/${name}`),
  ];
}

export function createFreezeDescriptor() {
  const promptSha256 = sha256(initialTicket());
  return {
    contract: 'f8-v24-historical-release-maintenance-pilot-v1',
    g0Commit: '72a165662c',
    sourceRevision: VELERO_REVISION,
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    requestedDaybreak: 'off via Standard; effective route not attested',
    requestedReasoningEffort: 'medium',
    caseOrder: [...CASE_ORDER],
    promptSha256: [promptSha256, promptSha256],
    responseContract: 'one JSON tool request per fresh read-only CLI turn',
    replacement: 'one fresh whole-case attempt only for provider/routing or malformed model JSON',
    stop: 'case 2 after valid case 1; two exact close; any substantive miss independently audited',
    manualReview:
      'safe alternative executable edits remain unscored until independent safety/equivalence adjudication',
    files: frozenFiles().map((path) => ({
      path,
      sha256: sha256(readFileSync(join(repoRoot, path))),
    })),
  };
}

export function verifyFreezeDescriptor(descriptor) {
  if (JSON.stringify(descriptor) !== JSON.stringify(createFreezeDescriptor())) {
    throw new Error('pilot freeze mismatch');
  }
}

function sharedRepoRoot() {
  return dirname(gitOutput(['rev-parse', '--git-common-dir']));
}

export function permissionArgs({ workspace, authHome, sourceRepo, rawDir }) {
  const permissions = {
    ':root': 'deny',
    ':minimal': 'read',
    '/System/Library/OpenSSL': 'read',
    '/private/tmp': 'deny',
    '/tmp': 'deny',
    [sharedRepoRoot()]: 'deny',
    [sourceRepo]: 'deny',
    [rawDir]: 'deny',
    [resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'))]: 'deny',
    [dirname(process.execPath)]: 'read',
    [dirname(workspace)]: 'read',
    [authHome]: 'deny',
    [workspace]: 'read',
  };
  const filesystem = `{${Object.entries(permissions)
    .map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`)
    .join(',')}}`;
  return [
    '-c',
    'default_permissions="f8v24"',
    '-c',
    `permissions.f8v24.filesystem=${filesystem}`,
    '-c',
    'permissions.f8v24.network.enabled=false',
  ];
}

export function buildModelArgs(workspace, outputPath, boundary) {
  return [
    'exec',
    '--ephemeral',
    '--json',
    '-m',
    'gpt-6.2-astra',
    '--cyber-access-program',
    'standard',
    '-c',
    'model_reasoning_effort="medium"',
    ...permissionArgs({ workspace, ...boundary }),
    '--ignore-user-config',
    '--output-last-message',
    outputPath,
    '--skip-git-repo-check',
    '-C',
    workspace,
    '-',
  ];
}

function writeExclusive(root, name, bytes) {
  const path = assertSafeWithin(root, join(root, name));
  writeFileSync(path, bytes, { flag: 'wx' });
  if (!lstatSync(path).isFile()) {
    throw new Error('raw output is not a regular file');
  }
  return { file: name, sha256: sha256(bytes) };
}

function readSafe(root, name) {
  const path = assertSafeWithin(root, join(root, name));
  if (!lstatSync(path).isFile()) {
    throw new Error('raw evidence file is not regular');
  }
  return readFileSync(path);
}

function gitOutput(args) {
  const run = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`git inspection failed: ${run.stderr}`);
  }
  return run.stdout.trim();
}

function ensureSourceRepo(sourceRepo) {
  if (!sourceRepo) {
    throw new Error('F8_VELERO_PUBLIC_REPO is required');
  }
  if (!lstatSync(sourceRepo).isDirectory() || realpathSync(sourceRepo) !== sourceRepo) {
    throw new Error('public source checkout must be a real directory');
  }
  const revision = spawnSync('git', ['-C', sourceRepo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['-C', sourceRepo, 'status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (
    revision.status !== 0 ||
    revision.stdout.trim() !== VELERO_REVISION ||
    status.status !== 0 ||
    status.stdout.trim()
  ) {
    throw new Error('public source checkout must be clean at the pinned tag commit');
  }
}

function codexVersion() {
  const run = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`local CLI preflight failed: ${run.stderr}`);
  }
  return run.stdout.trim();
}

function codexExecutable() {
  const run = spawnSync('which', ['codex'], { encoding: 'utf8' });
  if (run.status !== 0 || !run.stdout.trim().startsWith('/')) {
    throw new Error('Codex CLI executable not found');
  }
  return run.stdout.trim();
}

function hostAuthFile() {
  const root = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  const file = join(root, 'auth.json');
  if (!lstatSync(file).isFile() || realpathSync(file) !== file) {
    throw new Error('host Codex auth must be a regular non-symlink file');
  }
  return file;
}

function createIsolationRuntime(isolation) {
  const home = join(isolation, 'home');
  const codexHome = join(isolation, 'auth-only');
  const temporary = join(isolation, 'tmp');
  const workspace = join(isolation, 'workspace');
  for (const path of [home, codexHome, temporary, workspace]) {
    mkdirSync(path, { mode: 0o700 });
  }
  const auth = join(codexHome, 'auth.json');
  copyFileSync(hostAuthFile(), auth);
  const executable = codexExecutable();
  return {
    executable,
    workspace,
    codexHome,
    env: buildModelEnvironment({ executable, home, codexHome, temporary }),
  };
}

export function buildModelEnvironment({ executable, home, codexHome, temporary }) {
  return {
    PATH: `${dirname(executable)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    CODEX_HOME: codexHome,
    TMPDIR: temporary,
    LANG: 'en_US.UTF-8',
  };
}

function cliCommand({ workspace, runtime, executable, args, input, timeout = 10_000 }) {
  return spawnSync(executable, args, {
    cwd: workspace,
    env: runtime.env,
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8_000_000,
  });
}

export function probeModelIsolation({ sourceRepo, rawDir }) {
  const isolation = mkdtempSync(join(tmpdir(), 'f8-v24-profile-probe-'));
  try {
    const runtime = createIsolationRuntime(isolation);
    const run = (executable, args) =>
      cliCommand({
        workspace: runtime.workspace,
        runtime,
        executable,
        args,
      });
    const login = run(runtime.executable, ['login', 'status']);
    if (login.status !== 0 || !`${login.stdout}${login.stderr}`.includes('Logged in')) {
      throw new Error(
        `sandboxed auth-only Codex login probe failed: exit-${login.status} ${login.error?.message ?? login.stderr.slice(-500)}`,
      );
    }
    const help = run(runtime.executable, ['exec', '--help']);
    if (help.status !== 0 || !`${help.stdout}${help.stderr}`.includes('--cyber-access-program')) {
      throw new Error('sandboxed Codex executable probe failed');
    }
    const publicCanary = join(runtime.workspace, 'read-canary.txt');
    writeFileSync(publicCanary, 'public canary\n', { flag: 'wx' });
    const nativeArgs = permissionArgs({
      workspace: runtime.workspace,
      authHome: runtime.codexHome,
      sourceRepo,
      rawDir,
    });
    const native = (executable, args) =>
      run(runtime.executable, ['sandbox', '-P', 'f8v24', ...nativeArgs, executable, ...args]);
    const nativePublic = native('/bin/cat', [publicCanary]);
    if (nativePublic.status !== 0) {
      throw new Error(
        `managed native-tool public read probe failed: ${nativePublic.stderr.slice(-500)}`,
      );
    }
    for (const file of [
      join(sharedRepoRoot(), '.git', 'HEAD'),
      join(repoRoot, fixture, 'current-image-b.json'),
      join(sourceRepo, 'go.mod'),
      hostAuthFile(),
      join(runtime.codexHome, 'auth.json'),
    ]) {
      if (native('/bin/cat', [file]).status === 0) {
        throw new Error('managed native-tool private-read deny probe failed');
      }
    }
    if (
      native('/bin/ls', [rawDir]).status === 0 ||
      native('/usr/bin/touch', [join(runtime.workspace, 'native-write-canary')]).status === 0
    ) {
      throw new Error('managed native-tool raw-read/write deny probe failed');
    }
    return {
      permissionArgsSha256: sha256(JSON.stringify(nativeArgs)),
      localCodexAuth: 'auth-only temporary home passed',
      publicRead: 'passed',
      nativeToolReadDenials: 6,
      nativeToolWriteDenied: true,
      limitation: 'these OS probes do not attest future provider routing or model conduct',
    };
  } finally {
    rmSync(isolation, { recursive: true, force: true });
  }
}

export function preparePilot({ sourceRepo, rawDir = defaultRawDir } = {}) {
  ensureSourceRepo(sourceRepo);
  if (!existsSync(frozenDir)) {
    mkdirSync(frozenDir, { recursive: true });
  }
  assertSafeWithin(repoRoot, frozenDir);
  if (!existsSync(rawDir)) {
    mkdirSync(rawDir, { recursive: true });
  }
  assertSafeWithin(rawDir, rawDir);
  if (existsSync(join(frozenDir, 'freeze.json')) || readdirSync(rawDir).length > 0) {
    throw new Error('pilot already prepared or raw directory is not empty');
  }
  const preflight = {
    localCliVersion: codexVersion(),
    nodeVersion: process.version,
    requestedArgs: buildModelArgs(
      '/private/var/folders/<fresh-empty-dir>/workspace',
      '<last-message-file>',
      {
        authHome: '/private/var/folders/<fresh-empty-dir>/auth-only',
        sourceRepo,
        rawDir,
      },
    ),
    sourceRevision: VELERO_REVISION,
    isolation: probeModelIsolation({ sourceRepo, rawDir }),
    limitation:
      'local CLI and source checks do not attest provider route or future Docker/network availability',
  };
  writeExclusive(frozenDir, 'preflight.json', `${JSON.stringify(preflight, null, 2)}\n`);
  for (const caseNumber of [1, 2]) {
    writeExclusive(frozenDir, `case-${caseNumber}-initial-prompt.txt`, initialTicket());
  }
  const freeze = createFreezeDescriptor();
  writeExclusive(frozenDir, 'freeze.json', `${JSON.stringify(freeze, null, 2)}\n`);
  return { freezeSha256: sha256(readFileSync(join(frozenDir, 'freeze.json'))) };
}

export function selectPilotCase(rawDir, caseNumber, candidateCommit, freezeSha256, promptSha256) {
  if (![1, 2].includes(caseNumber)) {
    throw new Error('run one preregistered case: 1 or 2');
  }
  if (
    existsSync(join(rawDir, `case-${caseNumber}-launch.json`)) ||
    existsSync(join(rawDir, `case-${caseNumber}-result.json`)) ||
    readdirSync(rawDir).some((name) => name.startsWith(`case-${caseNumber}-attempt-`))
  ) {
    throw new Error('case already launched or has interrupted raw evidence');
  }
  if (caseNumber === 1) {
    return [];
  }
  const prior = JSON.parse(readSafe(rawDir, 'case-1-result.json').toString('utf8'));
  const aggregate = JSON.parse(readSafe(rawDir, 'results.json').toString('utf8'));
  if (
    !Array.isArray(aggregate) ||
    aggregate.length !== 1 ||
    JSON.stringify(aggregate[0]) !== JSON.stringify(prior) ||
    prior.caseNumber !== 1 ||
    prior.caseId !== CASE_ORDER[0] ||
    prior.candidateCommit !== candidateCommit ||
    prior.freezeSha256 !== freezeSha256 ||
    prior.promptSha256 !== promptSha256 ||
    !['valid_success', 'valid_failure'].includes(prior.finalClassification)
  ) {
    throw new Error('case 1 is not a matching valid scored predecessor');
  }
  if (
    !Array.isArray(prior.attempts) ||
    ![1, 2].includes(prior.attempts.length) ||
    prior.attempts.at(-1).classification !== 'submitted' ||
    !prior.score ||
    prior.finalClassification !== (prior.score.exact ? 'valid_success' : 'valid_failure') ||
    (prior.attempts.length === 2 &&
      !['provider_error', 'invalid_run'].includes(prior.attempts[0].classification))
  ) {
    throw new Error('case 1 attempt or score boundary mismatch');
  }
  for (const attempt of prior.attempts) {
    if (!Array.isArray(attempt.turns)) {
      throw new Error('case 1 turn record is incomplete');
    }
    for (const turn of attempt.turns) {
      for (const record of Object.values(turn.rawFiles)) {
        if (sha256(readSafe(rawDir, record.file)) !== record.sha256) {
          throw new Error('case 1 raw evidence hash mismatch');
        }
      }
      const prompt = readSafe(rawDir, turn.rawFiles.prompt.file).toString('utf8');
      const raw = readSafe(rawDir, turn.rawFiles.message.file).toString('utf8');
      const replay = classifyCliTurn({
        raw,
        eventStream: readSafe(rawDir, turn.rawFiles.events.file).toString('utf8'),
        stderr: readSafe(rawDir, turn.rawFiles.stderr.file).toString('utf8'),
        exitStatus: turn.exitStatus,
      });
      if (
        prompt !== turn.prompt ||
        replay.classification !== turn.classification ||
        JSON.stringify(replay.action ?? null) !== JSON.stringify(turn.action ?? null)
      ) {
        throw new Error('case 1 raw turn does not replay');
      }
    }
  }
  const replay = scoreReleaseSubmission({
    initialArm: 'affected',
    submission: prior.submission,
    inspection: prior.inspection,
  });
  if (JSON.stringify(replay) !== JSON.stringify(prior.score)) {
    throw new Error('case 1 score does not replay');
  }
  return [prior];
}

function assertCleanCandidate() {
  if (gitOutput(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('pilot requires a clean committed candidate');
  }
}

function modelInvoker(rawDir, caseNumber, sourceRepo) {
  return async (prompt, attemptNumber, turnNumber) => {
    const isolation = mkdtempSync(join(tmpdir(), 'f8-v24-astra-'));
    const messagePath = join(isolation, 'last-message.txt');
    const prefix = `case-${caseNumber}-attempt-${attemptNumber}-turn-${turnNumber}`;
    try {
      const runtime = createIsolationRuntime(isolation);
      const args = buildModelArgs(runtime.workspace, messagePath, {
        authHome: runtime.codexHome,
        sourceRepo,
        rawDir,
      });
      const run = cliCommand({
        workspace: runtime.workspace,
        runtime,
        executable: runtime.executable,
        args,
        input: prompt,
        timeout: 240_000,
      });
      const outputExists = lstatSync(messagePath, { throwIfNoEntry: false });
      if (outputExists && !outputExists.isFile()) {
        throw new Error('CLI final message is not a regular file');
      }
      const raw = outputExists
        ? readFileSync(assertSafeWithin(isolation, messagePath), 'utf8')
        : '';
      const eventStream = run.stdout ?? '';
      const stderr = run.stderr ?? '';
      const rawFiles = {
        prompt: writeExclusive(rawDir, `${prefix}-prompt.txt`, prompt),
        events: writeExclusive(rawDir, `${prefix}-events.jsonl`, eventStream),
        stderr: writeExclusive(rawDir, `${prefix}-stderr.txt`, stderr),
        message: writeExclusive(rawDir, `${prefix}-message.txt`, raw),
      };
      return {
        raw,
        eventStream,
        stderr,
        exitStatus: run.status,
        error: run.error,
        rawFiles,
        args,
      };
    } finally {
      rmSync(isolation, { recursive: true, force: true });
    }
  };
}

function conciseAttempts(attempts) {
  return attempts.map(({ attemptNumber, classification, reason, submission, turns }) => ({
    attemptNumber,
    classification,
    reason: reason ?? null,
    submission: submission ?? null,
    turns: turns.map(
      ({
        turnNumber,
        prompt,
        response,
        classification: turnClassification,
        reason: turnReason,
        action,
        observation,
      }) => ({
        turnNumber,
        prompt,
        classification: turnClassification,
        reason: turnReason ?? null,
        action: action ?? null,
        observation: observation ?? null,
        rawFiles: response.rawFiles,
        exitStatus: response.exitStatus,
        args: response.args,
      }),
    ),
  }));
}

export function baselineSourceFiles(arm) {
  if (arm === 'historical') {
    return {};
  }
  if (arm === 'already_patched') {
    return {
      'hack/fix_restic_cve.txt': readFileSync(
        join(repoRoot, fixture, 'already-patched-restic.txt'),
        'utf8',
      ),
    };
  }
  throw new Error('unknown pilot source arm');
}

function inspectSubmission({ sourceRepo, submission, baselineFiles }) {
  const benignInput = readFileSync(join(repoRoot, fixture, 'customer.txt'));
  const inspection = previewRelease({ sourceRepo, files: submission.files, benignInput });
  if (inspection.reviewRequired) {
    return { classification: 'manual_review_pending', reason: inspection.reason, inspection: null };
  }
  if (inspection.status !== 0) {
    const baseline = previewRelease({ sourceRepo, files: baselineFiles, benignInput });
    return {
      classification: baseline.status === 0 ? 'build_review_pending' : 'harness_error',
      reason:
        baseline.status === 0
          ? 'candidate build failed; independent failure attribution required'
          : 'trusted unchanged release baseline also failed',
      inspection: { candidate: inspection, baseline },
    };
  }
  return {
    classification: 'scored',
    inspection: {
      ...inspection,
      binaries: Object.fromEntries(
        inspection.binaries.map(({ artifactPath, ...metadata }) => [
          artifactPath === '/velero' ? 'velero' : 'restic',
          metadata,
        ]),
      ),
    },
  };
}

export function wrapPilotSession(session, trustedBaseline) {
  return {
    history: () => session.history(),
    handle(action) {
      const handled = session.handle(action);
      if (
        action?.tool !== 'build_release' ||
        handled.observation?.reviewRequired ||
        handled.observation?.status === 0
      ) {
        return handled;
      }
      let baseline;
      try {
        baseline = trustedBaseline();
      } catch (error) {
        return { ...handled, harnessError: `trusted unchanged baseline failed: ${String(error)}` };
      }
      if (baseline.status !== 0) {
        return {
          ...handled,
          harnessError: 'trusted unchanged baseline failed after candidate build trouble',
        };
      }
      if (handled.observation?.error || handled.observation?.status === null) {
        return {
          ...handled,
          harnessError: 'trusted candidate build tool raised an unclassified error',
        };
      }
      return handled;
    },
  };
}

export async function runPilotCase({ caseNumber, sourceRepo, rawDir = defaultRawDir }) {
  ensureSourceRepo(sourceRepo);
  assertCleanCandidate();
  assertSafeWithin(repoRoot, frozenDir);
  assertSafeWithin(rawDir, rawDir);
  const freezeBytes = readSafe(frozenDir, 'freeze.json');
  const freeze = JSON.parse(freezeBytes.toString('utf8'));
  verifyFreezeDescriptor(freeze);
  const expectedPromptSha256 = freeze.promptSha256[caseNumber - 1];
  for (const number of [1, 2]) {
    const bytes = readSafe(frozenDir, `case-${number}-initial-prompt.txt`);
    if (
      sha256(bytes) !== freeze.promptSha256[number - 1] ||
      bytes.toString('utf8') !== initialTicket()
    ) {
      throw new Error('frozen model prompt mismatch');
    }
  }
  const candidateCommit = gitOutput(['rev-parse', 'HEAD']);
  const freezeSha256 = sha256(freezeBytes);
  const priorResults = selectPilotCase(
    rawDir,
    caseNumber,
    candidateCommit,
    freezeSha256,
    expectedPromptSha256,
  );
  writeExclusive(
    rawDir,
    `case-${caseNumber}-launch.json`,
    `${JSON.stringify(
      {
        caseNumber,
        candidateCommit,
        freezeSha256,
        promptSha256: expectedPromptSha256,
        sourceRevision: VELERO_REVISION,
        localCliVersion: codexVersion(),
        requestedModel: freeze.model,
        requestedProgram: freeze.requestedProgram,
      },
      null,
      2,
    )}\n`,
  );
  const arm = caseNumber === 1 ? 'historical' : 'already_patched';
  const initialArm = caseNumber === 1 ? 'affected' : 'already_patched';
  let run;
  try {
    const benignInput = readFileSync(join(repoRoot, fixture, 'customer.txt'));
    run = await runCaseWithReplacement({
      sessionFactory: () => {
        const visible = createVisibleSession({ sourceRepo, arm });
        const baselineFiles = visible.browser.materializedFiles();
        return wrapPilotSession(visible.session, () =>
          previewRelease({ sourceRepo, files: baselineFiles, benignInput }),
        );
      },
      invoke: modelInvoker(rawDir, caseNumber, sourceRepo),
    });
  } catch (error) {
    run = { classification: 'harness_error', reason: String(error), attempts: [] };
  }
  const lastAttempt = run.attempts.at(-1);
  let finalClassification = run.classification;
  let reason = lastAttempt?.reason ?? run.reason ?? null;
  let inspection = null;
  let score = null;
  const submission = lastAttempt?.classification === 'submitted' ? lastAttempt.submission : null;
  if (submission) {
    try {
      const evaluated = inspectSubmission({
        sourceRepo,
        submission,
        baselineFiles: baselineSourceFiles(arm),
      });
      finalClassification = evaluated.classification;
      reason = evaluated.reason ?? null;
      inspection = evaluated.inspection;
      if (evaluated.classification === 'scored') {
        score = scoreReleaseSubmission({ initialArm, submission, inspection });
        finalClassification = score.exact ? 'valid_success' : 'valid_failure';
      }
    } catch (error) {
      finalClassification = 'harness_error';
      reason = `trusted final release inspection failed: ${String(error)}`;
    }
  }
  const record = {
    caseNumber,
    caseId: CASE_ORDER[caseNumber - 1],
    initialArm,
    candidateCommit,
    freezeSha256,
    promptSha256: expectedPromptSha256,
    finalClassification,
    reason,
    attempts: conciseAttempts(run.attempts),
    submission,
    inspection,
    score,
  };
  writeExclusive(rawDir, `case-${caseNumber}-result.json`, `${JSON.stringify(record, null, 2)}\n`);
  const aggregate = [...priorResults, record];
  if (caseNumber === 1) {
    writeExclusive(rawDir, 'results.json', `${JSON.stringify(aggregate, null, 2)}\n`);
  } else {
    const next = assertSafeWithin(rawDir, join(rawDir, 'results-next.json'));
    writeFileSync(next, `${JSON.stringify(aggregate, null, 2)}\n`, { flag: 'wx' });
    renameSync(next, assertSafeWithin(rawDir, join(rawDir, 'results.json')));
  }
  return record;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceRepo = process.env.F8_VELERO_PUBLIC_REPO;
  const rawDir = process.env.F8_VELERO_PILOT_RAW_DIR ?? defaultRawDir;
  if (process.argv.includes('--prepare')) {
    process.stdout.write(`${JSON.stringify(preparePilot({ sourceRepo, rawDir }))}\n`);
  } else if (process.argv.includes('--run-case')) {
    const position = process.argv.indexOf('--run-case');
    const caseNumber = Number(process.argv[position + 1]);
    runPilotCase({ caseNumber, sourceRepo, rawDir })
      .then((record) =>
        process.stdout.write(
          `${JSON.stringify({
            caseNumber: record.caseNumber,
            finalClassification: record.finalClassification,
            score: record.score,
            reason: record.reason,
          })}\n`,
        ),
      )
      .catch((error) => {
        process.stderr.write(`${String(error)}\n`);
        process.exitCode = 1;
      });
  } else {
    throw new Error('use --prepare or --run-case 1|2');
  }
}
