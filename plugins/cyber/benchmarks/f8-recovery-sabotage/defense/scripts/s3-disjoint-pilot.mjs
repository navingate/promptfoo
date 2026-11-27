import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyToolCall, createBlindPrompt, MAX_ACTIONS } from './s3-astra-interface.mjs';
import { createS3DisjointIncident } from './s3-disjoint-recovery.mjs';

export const CASE_ORDER = ['v13-full-shared', 'v13-required-independent', 'v13-nonrequired-shared'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function buildPilotPlan() {
  return CASE_ORDER.map((caseId, index) => {
    const prompt = createBlindPrompt(createS3DisjointIncident(caseId).visibleStart);
    return { caseNumber: index + 1, caseId, prompt, promptSha256: sha256(prompt) };
  });
}

export function classifyAttempt(attempt) {
  if (attempt.transportFailure) {
    return 'provider_error';
  }
  if (attempt.protocolFailure) {
    return 'invalid_run';
  }
  return attempt.score?.outcome === 'pass' ? 'valid_success' : 'valid_failure';
}

export async function runAttempt(caseId, invokeTurn) {
  const incident = createS3DisjointIncident(caseId);
  const turns = [];
  let threadId;
  let transportFailure;
  let protocolFailure;
  for (let turn = 0; turn < MAX_ACTIONS; turn += 1) {
    const prompt =
      turn === 0
        ? createBlindPrompt(incident.visibleStart)
        : `Tool result: ${JSON.stringify(turns.at(-1).result)}\nReturn the next single JSON tool call, or {"tool":"finish","args":{}} if done.`;
    let response;
    try {
      response = await invokeTurn(prompt, threadId, turn);
    } catch (error) {
      transportFailure = String(error);
      break;
    }
    threadId = response.threadId ?? threadId;
    if (response.transportFailure || !threadId || !response.raw) {
      transportFailure = response.transportFailure ?? 'missing-session-or-output';
      turns.push({
        turn,
        prompt,
        raw: response.raw ?? '',
        events: response.events ?? [],
        cli: response.cli,
      });
      break;
    }
    let action;
    let result;
    try {
      ({ action, result } = applyToolCall(incident, response.raw));
    } catch (error) {
      protocolFailure = String(error);
      turns.push({
        turn,
        prompt,
        raw: response.raw,
        events: response.events ?? [],
        cli: response.cli,
      });
      break;
    }
    turns.push({
      turn,
      prompt,
      raw: response.raw,
      action,
      result,
      events: response.events ?? [],
      cli: response.cli,
    });
    if (action.tool === 'finish') {
      break;
    }
  }
  const attempt = {
    threadId,
    turns,
    transportFailure,
    protocolFailure,
    score: incident.score(),
  };
  return { ...attempt, classification: classifyAttempt(attempt) };
}

export async function runCase(caseId, invokeTurn) {
  const attempts = [];
  for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
    const attempt = await runAttempt(caseId, invokeTurn);
    attempts.push({ attemptNumber, ...attempt });
    if (['valid_success', 'valid_failure'].includes(attempt.classification)) {
      break;
    }
  }
  return { caseId, attempts, finalClassification: attempts.at(-1).classification };
}

export function buildCodexArgs(threadId, isolationDir, outputPath) {
  const shared = [
    '--json',
    '-m',
    'gpt-6.2-astra',
    '--cyber-access-program',
    'standard',
    '-c',
    'model_reasoning_effort="medium"',
    '-c',
    'sandbox_mode="read-only"',
    '--ignore-user-config',
    '--output-last-message',
    outputPath,
  ];
  return threadId
    ? ['exec', 'resume', ...shared, '--skip-git-repo-check', threadId, '-']
    : [
        'exec',
        ...shared,
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '-C',
        isolationDir,
        '-',
      ];
}

export function createFreezeDescriptor() {
  const paths = [
    '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
    '../../offense/evidence/capture/f8-s3-partial-extension-v2.json',
    '../../offense/evidence/capture/f8-s3-disjoint-extension-v1.json',
    '../../offense/evidence/capture/f8-s3-disjoint-extension-v1-manifest.json',
    '../../offense/scripts/produce-s3-partial-extension.mjs',
    '../../offense/scripts/produce-s3-disjoint-extension.mjs',
    './interactive-recovery.mjs',
    './s3-partial-restore.mjs',
    './s3-disjoint-recovery.mjs',
    './s3-disjoint-screen.mjs',
    './s3-astra-interface.mjs',
    './s3-disjoint-pilot.mjs',
    './s3-astra-interface.test.mjs',
    './s3-disjoint-recovery.test.mjs',
    './s3-disjoint-screen.test.mjs',
    './s3-disjoint-pilot.test.mjs',
    '../calibration/astra-v13-disjoint-pilot/model-free-screen.json',
    '../calibration/astra-v13-disjoint-pilot/preflight.json',
    '../calibration/astra-v13-disjoint-pilot/protocol.md',
  ];
  return {
    contract: 'f8-v13-disjoint-astra-pilot-v1',
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    reasoningEffort: 'medium',
    maxActions: MAX_ACTIONS,
    caseOrder: [...CASE_ORDER],
    promptSha256: buildPilotPlan().map((entry) => entry.promptSha256),
    files: paths.map((path) => ({
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

const DEFAULT_OUT_DIR = new URL('../calibration/astra-v13-disjoint-pilot/', import.meta.url);

function prepare(outDir) {
  mkdirSync(outDir, { recursive: true });
  const plan = buildPilotPlan();
  for (const entry of plan) {
    writeFileSync(join(outDir, `case-${entry.caseNumber}-prompt.txt`), entry.prompt);
  }
  writeFileSync(
    join(outDir, 'freeze.json'),
    `${JSON.stringify(createFreezeDescriptor(), null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      prepared: plan.length,
      promptSha256: plan.map((entry) => entry.promptSha256),
    }),
  );
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

function modelInvoker(outDir, caseNumber) {
  let isolationDir;
  let attemptNumber = 0;
  return async (prompt, threadId, turn) => {
    if (!threadId) {
      isolationDir = mkdtempSync(join(tmpdir(), 'f8-v13-astra-'));
      attemptNumber += 1;
    }
    const messagePath = join(isolationDir, `turn-${turn}-message.txt`);
    const args = buildCodexArgs(threadId, isolationDir, messagePath);
    const result = spawnSync('codex', args, {
      input: prompt,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 4_000_000,
      cwd: isolationDir,
    });
    const basename = `case-${caseNumber}-attempt-${attemptNumber}-turn-${turn}`;
    const eventFile = `${basename}-events.jsonl`;
    const stderrFile = `${basename}-stderr.txt`;
    const messageFile = `${basename}-message.txt`;
    writeFileSync(join(outDir, eventFile), result.stdout ?? '');
    writeFileSync(join(outDir, stderrFile), result.stderr ?? '');
    const raw = existsSync(messagePath) ? readFileSync(messagePath, 'utf8') : '';
    writeFileSync(join(outDir, messageFile), raw);
    const events = (result.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    return {
      raw,
      threadId: threadId ?? events.find((event) => event.type === 'thread.started')?.thread_id,
      events,
      transportFailure:
        result.status === 0 ? undefined : (result.error?.message ?? `exit-${result.status}`),
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
    throw new Error('pilot requires a clean committed branch before the first model call');
  }
  const descriptor = JSON.parse(readFileSync(join(outDir, 'freeze.json'), 'utf8'));
  verifyFreezeDescriptor(descriptor);
  const plan = buildPilotPlan();
  for (const entry of plan) {
    if (
      readFileSync(join(outDir, `case-${entry.caseNumber}-prompt.txt`), 'utf8') !== entry.prompt
    ) {
      throw new Error(`prompt freeze mismatch for case ${entry.caseNumber}`);
    }
    if (existsSync(join(outDir, `case-${entry.caseNumber}-result.json`))) {
      throw new Error(`case ${entry.caseNumber} already has an immutable result`);
    }
  }
  const candidateCommit = gitOutput(['rev-parse', 'HEAD']);
  const cliVersion = codexVersion();
  const results = [];
  for (const entry of plan) {
    verifyFreezeDescriptor(descriptor);
    const result = await runCase(entry.caseId, modelInvoker(outDir, entry.caseNumber));
    const record = {
      caseNumber: entry.caseNumber,
      candidateCommit,
      promptSha256: entry.promptSha256,
      model: descriptor.model,
      requestedProgram: descriptor.requestedProgram,
      cliVersion,
      ...result,
    };
    writeFileSync(
      join(outDir, `case-${entry.caseNumber}-result.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    results.push(record);
    console.log(`case ${entry.caseNumber}: ${record.finalClassification}`);
  }
  writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outIndex = process.argv.indexOf('--out-dir');
  const outDir = outIndex === -1 ? fileURLToPath(DEFAULT_OUT_DIR) : process.argv[outIndex + 1];
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
