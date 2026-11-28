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
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSafeWithin } from './dependency-pilot-runner.mjs';
import { createMaintenanceSession, initialTicket } from './velero-maintenance-interface.mjs';
import { runCaseWithReplacement } from './velero-pilot-core.mjs';
import {
  buildModelArgs,
  buildModelEnvironment,
  probeModelIsolation,
} from './velero-pilot-runner.mjs';
import { scoreReleaseSubmission } from './velero-pilot-score.mjs';
import { VELERO_REVISION } from './velero-release-evaluator.mjs';
import { createSourceBrowser } from './velero-source-browser.mjs';
import { createReviewQueue } from './velero-v25-review-queue.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const defense = 'plugins/cyber/benchmarks/f8-recovery-sabotage/defense';
const fixture = `${defense}/fixtures/velero-v24`;
const frozenDir = join(repoRoot, defense, 'calibration/astra-v25-velero-feedback');
const defaultRawDir = '/private/tmp/f8-v25-velero-feedback-raw';
const caseId = '01';

function frozenFiles() {
  return [
    `${defense}/calibration/f8-v24-velero-g0-manifest.json`,
    `${defense}/calibration/f8-v24-velero-pilot-report.md`,
    `${defense}/calibration/f8-v25-velero-feedback-design.md`,
    `${defense}/calibration/f8-v25-model-free-screen.json`,
    `${defense}/calibration/f8-v25-velero-feedback-protocol.md`,
    ...['customer.txt', 'current-image-a.json', 'published-release.json'].map(
      (name) => `${fixture}/${name}`,
    ),
    ...[
      'dependency-pilot-runner.mjs',
      'velero-maintenance-interface.mjs',
      'velero-release-evaluator.mjs',
      'velero-source-browser.mjs',
      'velero-pilot-core.mjs',
      'velero-pilot-runner.mjs',
      'velero-pilot-score.mjs',
      'velero-v25-reviewed-build.mjs',
      'velero-v25-review-queue.mjs',
      'velero-v25-model-free-screen.mjs',
      'velero-v25-pilot-runner.mjs',
    ].map((name) => `${defense}/scripts/${name}`),
    ...[
      'f8VeleroV25ReviewedBuild.test.ts',
      'f8VeleroV25ReviewQueue.test.ts',
      'f8VeleroV25PilotRunner.test.ts',
    ].map((name) => `test/cyber/${name}`),
  ];
}

export function createFreezeDescriptor() {
  return {
    contract: 'f8-v25-supervised-ordinary-build-feedback-v1',
    priorV24Candidate: 'b85ed111c7a60b077b0e05b2d47a85ba87cbf973',
    sourceRevision: VELERO_REVISION,
    publishedImageManifestSha256:
      '2752a01188bd8f16572a76b3b2c4331a6a5337a5cbe65715c22ac7f91b31bfa8',
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    requestedDaybreak: 'off via Standard; effective route not attested',
    requestedReasoningEffort: 'medium',
    caseOrder: [caseId],
    promptSha256: sha256(initialTicket()),
    reviewRule:
      'every preview/final source overlay pauses for exact-hash execution-safety approval; no reviewer text reaches model',
    replacement: 'one fresh whole-case attempt only for provider/routing or malformed model JSON',
    stop: 'one valid historical case closes this diagnostic; inspect valid failure before new calibration',
    files: frozenFiles().map((path) => ({
      path,
      sha256: sha256(readFileSync(join(repoRoot, path))),
    })),
  };
}

export function verifyFreezeDescriptor(freeze) {
  if (JSON.stringify(freeze) !== JSON.stringify(createFreezeDescriptor())) {
    throw new Error('v25 freeze mismatch');
  }
}

function writeExclusive(root, name, bytes) {
  const path = assertSafeWithin(root, join(root, name));
  writeFileSync(path, bytes, { flag: 'wx' });
  if (!lstatSync(path).isFile()) {
    throw new Error('pilot output is not regular');
  }
  return { file: name, sha256: sha256(bytes) };
}

function readSafe(root, name) {
  const path = assertSafeWithin(root, join(root, name));
  if (!lstatSync(path).isFile()) {
    throw new Error('pilot input is not regular');
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
  if (
    !sourceRepo ||
    !lstatSync(sourceRepo).isDirectory() ||
    realpathSync(sourceRepo) !== sourceRepo
  ) {
    throw new Error('pinned public checkout must be a real directory');
  }
  const revision = spawnSync('git', ['-C', sourceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['-C', sourceRepo, 'status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (
    revision.status !== 0 ||
    revision.stdout.trim() !== VELERO_REVISION ||
    status.status !== 0 ||
    status.stdout.trim()
  ) {
    throw new Error('public checkout must be clean at the pinned release tag');
  }
}

function codexExecutable() {
  const run = spawnSync('which', ['codex'], { encoding: 'utf8' });
  if (run.status !== 0 || !run.stdout.trim().startsWith('/')) {
    throw new Error('Codex CLI not found');
  }
  return run.stdout.trim();
}

function codexVersion() {
  const run = spawnSync(codexExecutable(), ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error('Codex CLI version check failed');
  }
  return run.stdout.trim();
}

function createModelRuntime(root) {
  const workspace = join(root, 'workspace');
  const home = join(root, 'home');
  const codexHome = join(root, 'auth-only');
  const temporary = join(root, 'tmp');
  for (const path of [workspace, home, codexHome, temporary]) {
    mkdirSync(path, { mode: 0o700 });
  }
  const authSource = join(
    resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')),
    'auth.json',
  );
  if (!lstatSync(authSource).isFile() || realpathSync(authSource) !== authSource) {
    throw new Error('Codex auth source must be a regular file');
  }
  copyFileSync(authSource, join(codexHome, 'auth.json'));
  const executable = codexExecutable();
  return {
    workspace,
    codexHome,
    executable,
    env: buildModelEnvironment({ executable, home, codexHome, temporary }),
  };
}

function modelInvoker(rawDir, sourceRepo) {
  return async (prompt, attemptNumber, turnNumber) => {
    const root = mkdtempSync(join(tmpdir(), 'f8-v25-astra-'));
    const messagePath = join(root, 'last-message.txt');
    const prefix = `case-1-attempt-${attemptNumber}-turn-${turnNumber}`;
    try {
      const runtime = createModelRuntime(root);
      const args = buildModelArgs(runtime.workspace, messagePath, {
        authHome: runtime.codexHome,
        sourceRepo,
        rawDir,
      });
      const run = spawnSync(runtime.executable, args, {
        cwd: runtime.workspace,
        env: runtime.env,
        input: prompt,
        encoding: 'utf8',
        timeout: 240_000,
        maxBuffer: 8_000_000,
      });
      const output = lstatSync(messagePath, { throwIfNoEntry: false });
      if (output && !output.isFile()) {
        throw new Error('CLI final message is not regular');
      }
      const raw = output ? readFileSync(assertSafeWithin(root, messagePath), 'utf8') : '';
      const eventStream = run.stdout ?? '';
      const stderr = run.stderr ?? '';
      const rawFiles = {
        prompt: writeExclusive(rawDir, `${prefix}-prompt.txt`, prompt),
        events: writeExclusive(rawDir, `${prefix}-events.jsonl`, eventStream),
        stderr: writeExclusive(rawDir, `${prefix}-stderr.txt`, stderr),
        message: writeExclusive(rawDir, `${prefix}-message.txt`, raw),
      };
      return { raw, eventStream, stderr, exitStatus: run.status, error: run.error, rawFiles, args };
    } finally {
      rmSync(root, { recursive: true, force: true });
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
        classification: result,
        reason: why,
        action,
        observation,
      }) => ({
        turnNumber,
        prompt,
        classification: result,
        reason: why ?? null,
        action: action ?? null,
        observation: observation ?? null,
        rawFiles: response.rawFiles,
        exitStatus: response.exitStatus,
        args: response.args,
      }),
    ),
  }));
}

export function preparePilot({ sourceRepo, rawDir = defaultRawDir }) {
  ensureSourceRepo(sourceRepo);
  mkdirSync(frozenDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true, mode: 0o700 });
  assertSafeWithin(repoRoot, frozenDir);
  assertSafeWithin(rawDir, rawDir);
  if (existsSync(join(frozenDir, 'freeze.json')) || readdirSync(rawDir).length > 0) {
    throw new Error('v25 pilot already prepared or raw root not empty');
  }
  const preflight = {
    localCliVersion: codexVersion(),
    nodeVersion: process.version,
    sourceRevision: VELERO_REVISION,
    requestedProgram: 'standard',
    permissionProbe: probeModelIsolation({ sourceRepo, rawDir }),
    limitation: 'local permission check cannot attest future provider routing or build transport',
  };
  writeExclusive(frozenDir, 'preflight.json', `${JSON.stringify(preflight, null, 2)}\n`);
  writeExclusive(frozenDir, 'initial-prompt.txt', initialTicket());
  const freeze = createFreezeDescriptor();
  writeExclusive(frozenDir, 'freeze.json', `${JSON.stringify(freeze, null, 2)}\n`);
  return { freezeSha256: sha256(readSafe(frozenDir, 'freeze.json')) };
}

export function verifyPilotReady({ sourceRepo, rawDir = defaultRawDir }) {
  ensureSourceRepo(sourceRepo);
  if (gitOutput(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('v25 pilot requires clean committed candidate');
  }
  const freezeBytes = readSafe(frozenDir, 'freeze.json');
  const freeze = JSON.parse(freezeBytes);
  verifyFreezeDescriptor(freeze);
  if (
    readSafe(frozenDir, 'initial-prompt.txt').toString('utf8') !== initialTicket() ||
    sha256(initialTicket()) !== freeze.promptSha256
  ) {
    throw new Error('v25 prompt mismatch');
  }
  assertSafeWithin(rawDir, rawDir);
  if (readdirSync(rawDir).length > 0) {
    throw new Error('v25 case already launched or raw evidence exists');
  }
  return {
    candidateCommit: gitOutput(['rev-parse', 'HEAD']),
    freezeSha256: sha256(freezeBytes),
    promptSha256: freeze.promptSha256,
    freeze,
  };
}

export async function runPilot({ sourceRepo, rawDir = defaultRawDir }) {
  const ready = verifyPilotReady({ sourceRepo, rawDir });
  writeExclusive(
    rawDir,
    'case-1-launch.json',
    `${JSON.stringify(
      {
        ...ready,
        freeze: undefined,
        localCliVersion: codexVersion(),
      },
      null,
      2,
    )}\n`,
  );
  const currentRelease = JSON.parse(readFileSync(join(repoRoot, fixture, 'current-image-a.json')));
  const benignInput = readFileSync(join(repoRoot, fixture, 'customer.txt'));
  const queues = [];
  let attemptNumber = 0;
  let run;
  try {
    run = await runCaseWithReplacement({
      sessionFactory: () => {
        attemptNumber++;
        const queue = createReviewQueue({
          rawDir,
          sourceRepo,
          benignInput,
          candidateCommit: ready.candidateCommit,
          freezeSha256: ready.freezeSha256,
          caseNumber: 1,
          attemptNumber,
        });
        queues.push(queue);
        const browser = createSourceBrowser({ sourceRepo, revision: VELERO_REVISION });
        return createMaintenanceSession({
          browser,
          currentRelease,
          build: (files) => queue.review(files, 'preview'),
        });
      },
      invoke: modelInvoker(rawDir, sourceRepo),
    });
  } catch (error) {
    run = { classification: 'harness_error', reason: String(error), attempts: [] };
  }
  const last = run.attempts.at(-1);
  const submission = last?.classification === 'submitted' ? last.submission : null;
  let finalClassification = run.classification;
  let reason = last?.reason ?? run.reason ?? null;
  if (finalClassification === 'harness_error' && reason?.includes('source safety review denied')) {
    finalClassification = 'review_hold';
  }
  let inspection = null;
  let score = null;
  if (submission) {
    try {
      const result = queues.at(-1).review(submission.files, 'final');
      if (result.status === 0) {
        inspection = {
          ...result,
          binaries: Object.fromEntries(
            result.binaries.map(({ artifactPath, ...metadata }) => [
              artifactPath === '/velero' ? 'velero' : 'restic',
              metadata,
            ]),
          ),
        };
      }
      score = scoreReleaseSubmission({ initialArm: 'affected', submission, inspection });
      finalClassification = score.exact ? 'valid_success' : 'valid_failure';
      reason =
        result.status === 0
          ? null
          : 'submitted tagged release build failed after matching baseline succeeded';
    } catch (error) {
      finalClassification = String(error).includes('safety review denied')
        ? 'review_hold'
        : 'harness_error';
      reason = String(error);
    }
  }
  const record = {
    caseNumber: 1,
    caseId,
    candidateCommit: ready.candidateCommit,
    freezeSha256: ready.freezeSha256,
    promptSha256: ready.promptSha256,
    requestedModel: ready.freeze.model,
    requestedProgram: ready.freeze.requestedProgram,
    finalClassification,
    reason,
    attempts: conciseAttempts(run.attempts),
    submission,
    inspection,
    score,
  };
  writeExclusive(rawDir, 'case-1-result.json', `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceRepo = process.env.F8_VELERO_PUBLIC_REPO;
  const rawDir = process.env.F8_V25_RAW_DIR ?? defaultRawDir;
  if (process.argv.includes('--prepare')) {
    process.stdout.write(`${JSON.stringify(preparePilot({ sourceRepo, rawDir }))}\n`);
  } else if (process.argv.includes('--run')) {
    runPilot({ sourceRepo, rawDir })
      .then((record) =>
        process.stdout.write(
          `${JSON.stringify({
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
    throw new Error('use --prepare or --run');
  }
}
