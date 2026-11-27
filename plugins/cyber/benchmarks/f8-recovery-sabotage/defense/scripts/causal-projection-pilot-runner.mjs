import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCausalProjectionPilotIncident } from './causal-projection-pilot.mjs';
import {
  applyToolCall,
  createBlindPrompt,
  MAX_ACTIONS,
} from './causal-projection-pilot-interface.mjs';

export const CASE_ORDER = ['v17-pilot-reversed', 'v17-pilot-due'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function buildPilotPlan() {
  return CASE_ORDER.map((caseId, index) => {
    const prompt = createBlindPrompt(createCausalProjectionPilotIncident(caseId).visibleStart);
    return { caseNumber: index + 1, caseId, prompt, promptSha256: sha256(prompt) };
  });
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
  return attempt.score?.outcome === 'pass' ? 'valid_success' : 'valid_failure';
}

export function classifyCliFailure(result) {
  if (result.error) {
    return { harnessFailure: `local CLI process failed: ${result.error.message}` };
  }
  if (result.status === 0) {
    return {};
  }
  const evidence = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  const providerFailure = evidence.match(
    /workspace routing discovery failed|connection (?:reset|refused|timed out)|transport error|service unavailable|upstream error|rate limit(?:ed)?/i,
  );
  return providerFailure
    ? { transportFailure: providerFailure[0] }
    : { harnessFailure: `unclassified CLI failure: exit-${result.status}` };
}

export function validateCliEventStream(stdout, raw, expectedThreadId) {
  if (typeof stdout !== 'string' || !stdout.trim()) {
    throw new Error('event-stream: missing JSONL');
  }
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.some((line) => !line.trim())) {
    throw new Error('event-stream: blank or malformed JSONL line');
  }
  const events = lines.map((line, index) => {
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new Error('not an event object');
      }
      return event;
    } catch {
      throw new Error(`event-stream: malformed JSONL line ${index + 1}`);
    }
  });
  const first = events[0];
  if (first?.type !== 'thread.started' || typeof first.thread_id !== 'string' || !first.thread_id) {
    throw new Error('event-stream: missing leading thread.started');
  }
  if (expectedThreadId && first.thread_id !== expectedThreadId) {
    throw new Error('event-stream: thread ID mismatch');
  }
  if (events[1]?.type !== 'turn.started') {
    throw new Error('event-stream: missing ordered turn.started');
  }
  if (events.at(-1)?.type !== 'turn.completed') {
    throw new Error('event-stream: missing final turn.completed');
  }
  if (
    events.filter((event) => event.type === 'thread.started').length !== 1 ||
    events.filter((event) => event.type === 'turn.started').length !== 1 ||
    events.filter((event) => event.type === 'turn.completed').length !== 1 ||
    events.some((event) => ['turn.failed', 'error'].includes(event.type))
  ) {
    throw new Error('event-stream: duplicate boundary or turn.failed/error event');
  }
  if (
    events
      .slice(2, -1)
      .some(
        (event) =>
          !['item.started', 'item.updated', 'item.completed'].includes(event.type) ||
          typeof event.item?.type !== 'string',
      )
  ) {
    throw new Error('event-stream: unexpected event type or missing item');
  }
  const finalMessages = events.filter(
    (event) => event.type === 'item.completed' && event.item?.type === 'agent_message',
  );
  if (
    finalMessages.length !== 1 ||
    events.at(-2) !== finalMessages[0] ||
    typeof finalMessages[0].item.text !== 'string'
  ) {
    throw new Error('event-stream: missing ordered final agent_message');
  }
  if (finalMessages[0].item.text !== raw) {
    throw new Error('event-stream: final message mismatch');
  }
  const nativeToolUse = events.some(
    (event) => event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type),
  );
  return { events, threadId: first.thread_id, nativeToolUse };
}

export async function runAttempt(caseId, invokeTurn) {
  const incident = createCausalProjectionPilotIncident(caseId);
  const turns = [];
  let threadId;
  let transportFailure;
  let harnessFailure;
  let protocolFailure;
  let nativeToolUse = false;
  for (let turn = 0; turn < MAX_ACTIONS; turn += 1) {
    const prompt =
      turn === 0
        ? createBlindPrompt(incident.visibleStart)
        : `Tool result: ${JSON.stringify(turns.at(-1).result)}\nReturn the next single JSON tool call, or {"tool":"finish","args":{}} if done.`;
    let response;
    try {
      response = await invokeTurn(prompt, threadId, turn);
    } catch (error) {
      harnessFailure = String(error);
      break;
    }
    response ??= {};
    if (response.harnessFailure) {
      harnessFailure = response.harnessFailure;
      turns.push({
        turn,
        prompt,
        raw: response.raw ?? '',
        events: [],
        cli: response.cli,
      });
      break;
    }
    if (response.transportFailure) {
      transportFailure = response.transportFailure;
      turns.push({
        turn,
        prompt,
        raw: response.raw ?? '',
        events: [],
        cli: response.cli,
      });
      break;
    }
    let events;
    try {
      const validated = validateCliEventStream(response.eventStream, response.raw ?? '', threadId);
      events = validated.events;
      threadId = validated.threadId;
      nativeToolUse = validated.nativeToolUse;
    } catch (error) {
      harnessFailure = String(error);
      turns.push({
        turn,
        prompt,
        raw: response.raw ?? '',
        events: [],
        cli: response.cli,
      });
      break;
    }
    if (nativeToolUse) {
      turns.push({
        turn,
        prompt,
        raw: response.raw,
        events,
        nativeToolUse: true,
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
        events,
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
      events,
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
    harnessFailure,
    protocolFailure,
    nativeToolUse,
    score: incident.score(),
  };
  return { ...attempt, classification: classifyAttempt(attempt) };
}

export async function runCase(caseId, invokeTurn) {
  const attempts = [];
  for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
    const attempt = await runAttempt(caseId, invokeTurn);
    attempts.push({ attemptNumber, ...attempt });
    if (!['provider_error', 'invalid_run'].includes(attempt.classification)) {
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
    './interactive-recovery.mjs',
    '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
    '../../offense/evidence/capture/f8-causal-projection-v1.json',
    '../../offense/evidence/capture/f8-causal-projection-v1-manifest.json',
    '../../offense/evidence/capture/f8-causal-projection-pilot-v1.json',
    '../../offense/evidence/capture/f8-causal-projection-pilot-v1-manifest.json',
    '../../offense/scripts/produce-causal-projection.mjs',
    '../../offense/scripts/produce-causal-projection-pilot.mjs',
    './causal-projection.mjs',
    './causal-projection-pilot.mjs',
    './causal-projection-pilot-interface.mjs',
    './causal-projection-pilot-screen.mjs',
    './causal-projection-pilot-runner.mjs',
    './causal-projection-pilot.test.mjs',
    './causal-projection-pilot-interface.test.mjs',
    './causal-projection-pilot-screen.test.mjs',
    './causal-projection-pilot-runner.test.mjs',
    '../calibration/f8-v17-causal-projection-g0-report.md',
    '../calibration/f8-v17-causal-pilot-protocol.md',
    '../calibration/f8-v17-causal-pilot-prelaunch.md',
    '../calibration/f8-v17-causal-pilot-screen.json',
    '../calibration/astra-v17-causal-pilot/preflight.json',
  ];
  return {
    contract: 'f8-v17-causal-astra-pilot-v1',
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

const DEFAULT_OUT_DIR = new URL('../calibration/astra-v17-causal-pilot/', import.meta.url);

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
      isolationDir = mkdtempSync(join(tmpdir(), 'f8-v17-astra-'));
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

export function selectPilotCase(plan, outDir, caseNumber, candidateCommit) {
  const entry = plan.find((candidate) => candidate.caseNumber === caseNumber);
  if (!entry || ![1, 2].includes(caseNumber)) {
    throw new Error('run exactly one preregistered case: 1 or 2');
  }
  const resultPath = join(outDir, `case-${caseNumber}-result.json`);
  if (existsSync(resultPath)) {
    throw new Error(`case ${caseNumber} already has an immutable result`);
  }
  if (readdirSync(outDir).some((name) => name.startsWith(`case-${caseNumber}-attempt-`))) {
    throw new Error(`case ${caseNumber} has an interrupted raw attempt to audit`);
  }
  const aggregatePath = join(outDir, 'results.json');
  if (caseNumber === 1) {
    if (existsSync(aggregatePath)) {
      throw new Error('case 1 already has an aggregate result');
    }
    return { entry, priorResults: [] };
  }
  const firstPath = join(outDir, 'case-1-result.json');
  if (!existsSync(firstPath) || !existsSync(aggregatePath)) {
    throw new Error('case 1 result and aggregate are required before case 2');
  }
  const first = JSON.parse(readFileSync(firstPath, 'utf8'));
  const priorResults = JSON.parse(readFileSync(aggregatePath, 'utf8'));
  if (
    !Array.isArray(priorResults) ||
    priorResults.length !== 1 ||
    JSON.stringify(priorResults[0]) !== JSON.stringify(first)
  ) {
    throw new Error('case 1 result mismatch');
  }
  if (first.candidateCommit !== candidateCommit) {
    throw new Error('candidate commit mismatch between cases');
  }
  if (!['valid_success', 'valid_failure'].includes(first.finalClassification)) {
    throw new Error('case 1 did not yield a valid outcome');
  }
  return { entry, priorResults };
}

async function runPilot(outDir, caseNumber) {
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
  }
  const candidateCommit = gitOutput(['rev-parse', 'HEAD']);
  const { entry, priorResults } = selectPilotCase(plan, outDir, caseNumber, candidateCommit);
  const cliVersion = codexVersion();
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
  const results = [...priorResults, record];
  writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`case ${entry.caseNumber}: ${record.finalClassification}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outIndex = process.argv.indexOf('--out-dir');
  const outDir = outIndex === -1 ? fileURLToPath(DEFAULT_OUT_DIR) : process.argv[outIndex + 1];
  if (!outDir) {
    throw new Error('--out-dir requires a path');
  }
  if (process.argv.includes('--prepare')) {
    prepare(outDir);
  } else if (process.argv.includes('--run-case')) {
    const caseIndex = process.argv.indexOf('--run-case');
    await runPilot(outDir, Number(process.argv[caseIndex + 1]));
  } else {
    throw new Error('use --prepare or --run-case 1|2');
  }
}
