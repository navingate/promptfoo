// One fresh Standard-requested Astra plan; one decision scored over two durable histories.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCodexArgs as buildPriorCodexArgs,
  classifyCliFailure,
  validateCliEventStream,
} from './causal-projection-pilot-runner.mjs';
import {
  createPlanPrompt,
  executePlanBothHistories,
  MAX_STEPS,
  parsePlan,
  verifyPartialTarget,
} from './resumable-pilot.mjs';

export { validateCliEventStream };

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const OUT_DIR = new URL('../calibration/astra-v18-resumable-plan/', import.meta.url);

export function buildCodexArgs(isolationDir, outputPath) {
  return buildPriorCodexArgs(undefined, isolationDir, outputPath);
}

export function classifyAttempt(attempt) {
  if (attempt.transportFailure) {
    return 'provider_error';
  }
  if (attempt.harnessFailure) {
    return 'harness_error';
  }
  if (attempt.protocolFailure) {
    return 'invalid_run';
  }
  if (attempt.nativeToolUse) {
    return 'valid_failure';
  }
  return attempt.business?.outcome === 'pass' ? 'valid_success' : 'valid_failure';
}

export async function runAttempt(invoke) {
  const prompt = createPlanPrompt();
  const attempt = { promptSha256: sha256(prompt) };
  let response;
  try {
    response = (await invoke(prompt)) ?? {};
  } catch (error) {
    attempt.harnessFailure = String(error);
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  attempt.raw = response.raw ?? '';
  attempt.cli = response.cli;
  if (response.transportFailure) {
    attempt.transportFailure = response.transportFailure;
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  if (response.harnessFailure) {
    attempt.harnessFailure = response.harnessFailure;
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  try {
    const validated = validateCliEventStream(response.eventStream, attempt.raw);
    attempt.threadId = validated.threadId;
    attempt.events = validated.events;
    attempt.nativeToolUse = validated.nativeToolUse;
  } catch (error) {
    attempt.harnessFailure = String(error);
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  if (attempt.nativeToolUse) {
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  try {
    attempt.plan = parsePlan(attempt.raw);
  } catch (error) {
    attempt.protocolFailure = String(error);
    return { ...attempt, classification: classifyAttempt(attempt) };
  }
  try {
    attempt.business = executePlanBothHistories(attempt.plan);
  } catch (error) {
    attempt.harnessFailure = `plan execution failed: ${String(error)}`;
  }
  return { ...attempt, classification: classifyAttempt(attempt) };
}

export async function runDecision(invoke) {
  const attempts = [];
  for (let index = 0; index < 2; index += 1) {
    const result = await runAttempt((prompt) => invoke(prompt, index));
    attempts.push({ attemptNumber: index + 1, ...result });
    if (!['provider_error', 'invalid_run'].includes(result.classification)) {
      break;
    }
  }
  return {
    decisionCount: 1,
    historyCount: 2,
    attempts,
    finalClassification: attempts.at(-1).classification,
  };
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function codexVersion() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`codex --version failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

const FROZEN_FILES = [
  './interactive-recovery.mjs',
  './causal-projection-pilot-runner.mjs',
  './resumable-pilot-adapter.mjs',
  './resumable-pilot.mjs',
  './resumable-pilot-screen.mjs',
  './resumable-pilot-runner.mjs',
  './resumable-pilot.test.mjs',
  './resumable-pilot-runner.test.mjs',
  '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
  '../../offense/evidence/capture/f8-resumable-recovery-v1.json',
  '../../offense/evidence/capture/f8-resumable-recovery-v1-manifest.json',
  '../../offense/evidence/capture/f8-resumable-pilot-v1.json',
  '../../offense/evidence/capture/f8-resumable-pilot-v1-manifest.json',
  '../../offense/evidence/capture/f8-resumable-pilot-partial-target.json',
  '../../offense/scripts/produce-resumable-recovery.mjs',
  '../../offense/scripts/produce-resumable-pilot.mjs',
  '../calibration/f8-v18-resumable-g0-report.md',
  '../calibration/f8-v18-resumable-pilot-protocol.md',
  '../calibration/f8-v18-resumable-pilot-prelaunch.md',
  '../calibration/f8-v18-resumable-pilot-screen.json',
  '../calibration/astra-v18-resumable-plan/preflight.json',
];

export function createFreezeDescriptor() {
  const prompt = createPlanPrompt();
  verifyPartialTarget();
  return {
    contract: 'f8-v18-one-plan-two-histories-pilot-v1',
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    requestedReasoningEffort: 'medium',
    decisionCount: 1,
    historyOrder: ['clean', 'resume'],
    maxSteps: MAX_STEPS,
    replacement: 'one fresh-session replacement for provider failure or malformed model plan only',
    promptSha256: sha256(prompt),
    files: FROZEN_FILES.map((path) => ({
      path,
      sha256: sha256(readFileSync(new URL(path, import.meta.url))),
    })),
  };
}

export function verifyFreezeDescriptor(descriptor) {
  if (JSON.stringify(descriptor) !== JSON.stringify(createFreezeDescriptor())) {
    throw new Error('freeze mismatch');
  }
}

function prepare(outDir) {
  mkdirSync(outDir, { recursive: true });
  const preflight = {
    localCliVersion: codexVersion(),
    nodeVersion: process.version,
    requestedCliArgs: buildCodexArgs('<fresh-empty-dir>', '<output-message-file>'),
    limitation:
      'local CLI capability check only; provider routing and effective Daybreak are not attested',
  };
  writeFileSync(join(outDir, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`);
  writeFileSync(join(outDir, 'prompt.txt'), createPlanPrompt());
  const descriptor = createFreezeDescriptor();
  writeFileSync(join(outDir, 'freeze.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
  console.log(
    JSON.stringify({
      prepared: true,
      promptSha256: descriptor.promptSha256,
      freezeSha256: sha256(readFileSync(join(outDir, 'freeze.json'))),
    }),
  );
}

function modelInvoker(outDir) {
  return async (prompt, index) => {
    const isolationDir = mkdtempSync(join(tmpdir(), 'f8-v18-astra-'));
    const messagePath = join(isolationDir, 'message.txt');
    const args = buildCodexArgs(isolationDir, messagePath);
    const result = spawnSync('codex', args, {
      input: prompt,
      encoding: 'utf8',
      timeout: 240_000,
      maxBuffer: 8_000_000,
      cwd: isolationDir,
    });
    const raw = existsSync(messagePath) ? readFileSync(messagePath, 'utf8') : '';
    const prefix = `attempt-${index + 1}`;
    const eventFile = `${prefix}-events.jsonl`;
    const stderrFile = `${prefix}-stderr.txt`;
    const messageFile = `${prefix}-message.txt`;
    writeFileSync(join(outDir, eventFile), result.stdout ?? '');
    writeFileSync(join(outDir, stderrFile), result.stderr ?? '');
    writeFileSync(join(outDir, messageFile), raw);
    rmSync(isolationDir, { recursive: true, force: true });
    return {
      raw,
      eventStream: result.stdout ?? '',
      ...classifyCliFailure(result),
      cli: {
        args,
        exitStatus: result.status,
        eventFile,
        eventSha256: sha256(result.stdout ?? ''),
        stderrFile,
        stderrSha256: sha256(result.stderr ?? ''),
        messageFile,
        messageSha256: sha256(raw),
      },
    };
  };
}

async function runPilot(outDir) {
  if (gitOutput(['status', '--porcelain'])) {
    throw new Error('pilot requires clean committed worktree');
  }
  if (
    existsSync(join(outDir, 'result.json')) ||
    readdirSync(outDir).some((name) => name.startsWith('attempt-'))
  ) {
    throw new Error('frozen pilot already has a result or interrupted raw attempt');
  }
  const freezeBytes = readFileSync(join(outDir, 'freeze.json'));
  const descriptor = JSON.parse(freezeBytes.toString('utf8'));
  verifyFreezeDescriptor(descriptor);
  const prompt = createPlanPrompt();
  if (readFileSync(join(outDir, 'prompt.txt'), 'utf8') !== prompt) {
    throw new Error('frozen prompt mismatch');
  }
  const candidateCommit = gitOutput(['rev-parse', 'HEAD']);
  const result = await runDecision(modelInvoker(outDir));
  const record = {
    candidateCommit,
    freezeSha256: sha256(freezeBytes),
    promptSha256: sha256(prompt),
    model: descriptor.model,
    requestedProgram: descriptor.requestedProgram,
    cliVersion: codexVersion(),
    ...result,
  };
  writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(record, null, 2)}\n`);
  const hashes = readdirSync(outDir)
    .filter((name) => name !== 'SHA256SUMS')
    .sort()
    .map((name) => `${sha256(readFileSync(join(outDir, name)))}  ${name}`);
  writeFileSync(join(outDir, 'SHA256SUMS'), `${hashes.join('\n')}\n`);
  console.log(
    JSON.stringify({
      candidateCommit,
      freezeSha256: record.freezeSha256,
      classification: record.finalClassification,
      attemptCount: record.attempts.length,
      business:
        record.attempts.at(-1).business?.histories.map((entry) => ({
          history: entry.history,
          outcome: entry.score.outcome,
          laterUpdate: entry.score.metrics.later_update_preserved,
          currentEntitlement: entry.score.metrics.target_entitlement_active,
          approvedWork: entry.score.metrics.authorized_work_continues,
        })) ?? null,
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--out-dir');
  const outDir = index === -1 ? fileURLToPath(OUT_DIR) : process.argv[index + 1];
  if (!outDir) {
    throw new Error('--out-dir requires a path');
  }
  if (process.argv.includes('--prepare')) {
    prepare(outDir);
  } else if (process.argv.includes('--run')) {
    await runPilot(outDir);
  } else {
    throw new Error('use --prepare or --run');
  }
}
