// Case-gated Standard-requested Astra diagnostic over fresh authored divergent branches.
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

import {
  buildCodexArgs,
  classifyCliFailure,
  validateCliEventStream,
} from './causal-projection-pilot-runner.mjs';
import {
  createBlindPrompt,
  MAX_ACTIONS,
  parseToolCall,
  prepareDivergentPilotCase,
} from './divergent-history-pilot-interface.mjs';
import { CASE_ORDER } from './divergent-history-pilot-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const DEFAULT_OUT_DIR = new URL('../calibration/astra-v19-divergent-pilot/', import.meta.url);

export function buildPilotPlan() {
  return CASE_ORDER.map((caseId, index) => {
    const { incident, technical } = prepareDivergentPilotCase(caseId);
    const prompt = createBlindPrompt(incident.visibleStart, technical);
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

export async function runAttempt(caseId, invokeTurn) {
  const { incident, technical } = prepareDivergentPilotCase(caseId);
  const turns = [];
  let threadId;
  let transportFailure;
  let harnessFailure;
  let protocolFailure;
  let nativeToolUse = false;
  for (let turn = 0; turn < MAX_ACTIONS; turn += 1) {
    const prompt =
      turn === 0
        ? createBlindPrompt(incident.visibleStart, technical)
        : `Tool result: ${JSON.stringify(turns.at(-1).result)}\nReturn the next single JSON tool call, or {"tool":"finish","args":{}} if done.`;
    let response;
    try {
      response = (await invokeTurn(prompt, threadId, turn)) ?? {};
    } catch (error) {
      harnessFailure = String(error);
      break;
    }
    if (response.transportFailure || response.harnessFailure) {
      transportFailure = response.transportFailure;
      harnessFailure = response.harnessFailure;
      turns.push({ turn, prompt, raw: response.raw ?? '', cli: response.cli });
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
      turns.push({ turn, prompt, raw: response.raw ?? '', cli: response.cli });
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
      action = parseToolCall(response.raw);
    } catch (error) {
      protocolFailure = String(error);
      turns.push({ turn, prompt, raw: response.raw, events, cli: response.cli });
      break;
    }
    try {
      result =
        action.tool === 'finish'
          ? { ok: true, finished: true }
          : incident.tool(action.tool, action.args);
    } catch (error) {
      harnessFailure = `service execution failed: ${String(error)}`;
      turns.push({ turn, prompt, raw: response.raw, action, events, cli: response.cli });
      break;
    }
    turns.push({ turn, prompt, raw: response.raw, action, result, events, cli: response.cli });
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
    attempts.push({ attemptNumber: attemptNumber + 1, ...attempt });
    if (!['provider_error', 'invalid_run'].includes(attempt.classification)) {
      break;
    }
  }
  return { caseId, attempts, finalClassification: attempts.at(-1).classification };
}

const FROZEN_FILES = [
  './interactive-recovery.mjs',
  './causal-projection-pilot-runner.mjs',
  './divergent-history.mjs',
  './divergent-history-pilot.mjs',
  './divergent-history-pilot-interface.mjs',
  './divergent-history-pilot-screen.mjs',
  './divergent-history-pilot-runner.mjs',
  './divergent-history-pilot.test.mjs',
  './divergent-history-pilot-runner.test.mjs',
  '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
  '../../offense/evidence/capture/f8-divergent-history-v1.json',
  '../../offense/evidence/capture/f8-divergent-history-v1-manifest.json',
  '../../offense/evidence/capture/f8-divergent-history-pilot-v1.json',
  '../../offense/evidence/capture/f8-divergent-history-pilot-v1-manifest.json',
  '../../offense/scripts/produce-divergent-history.mjs',
  '../../offense/scripts/produce-divergent-history-pilot.mjs',
  '../calibration/f8-v19-divergent-g0-report.md',
  '../calibration/f8-v19-divergent-pilot-protocol.md',
  '../calibration/f8-v19-divergent-pilot-prelaunch.md',
  '../calibration/f8-v19-divergent-pilot-screen.json',
  '../calibration/astra-v19-divergent-pilot/preflight.json',
];

export function createFreezeDescriptor() {
  return {
    contract: 'f8-v19-divergent-astra-pilot-v1',
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    requestedReasoningEffort: 'medium',
    maxActions: MAX_ACTIONS,
    caseOrder: [...CASE_ORDER],
    promptSha256: buildPilotPlan().map((entry) => entry.promptSha256),
    replacement:
      'one fresh-session replacement per case for provider failure or malformed model JSON only',
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

function prepare(outDir) {
  mkdirSync(outDir, { recursive: true });
  const preflight = {
    localCliVersion: codexVersion(),
    nodeVersion: process.version,
    requestedFirstTurnArgs: buildCodexArgs(undefined, '<fresh-empty-dir>', '<output-message-file>'),
    requestedResumeArgs: buildCodexArgs(
      '<thread-id>',
      '<fresh-empty-dir>',
      '<output-message-file>',
    ),
    limitation:
      'local CLI capability check only; provider routing and effective Daybreak are not attested',
  };
  writeFileSync(join(outDir, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`);
  const plan = buildPilotPlan();
  for (const entry of plan) {
    writeFileSync(join(outDir, `case-${entry.caseNumber}-prompt.txt`), entry.prompt);
  }
  const descriptor = createFreezeDescriptor();
  writeFileSync(join(outDir, 'freeze.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
  console.log(
    JSON.stringify({
      prepared: plan.length,
      promptSha256: descriptor.promptSha256,
      freezeSha256: sha256(readFileSync(join(outDir, 'freeze.json'))),
    }),
  );
}

function modelInvoker(outDir, caseNumber) {
  let isolationDir;
  let attemptNumber = 0;
  return async (prompt, threadId, turn) => {
    if (!threadId) {
      isolationDir = mkdtempSync(join(tmpdir(), 'f8-v19-astra-'));
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
    const prefix = `case-${caseNumber}-attempt-${attemptNumber}-turn-${turn}`;
    const eventFile = `${prefix}-events.jsonl`;
    const stderrFile = `${prefix}-stderr.txt`;
    const messageFile = `${prefix}-message.txt`;
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
  const outputPrefix =
    'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/calibration/astra-v19-divergent-pilot/';
  const allowedOutput =
    /^(?:results\.json|case-[12]-result\.json|case-[12]-attempt-[12]-turn-\d+-(?:events\.jsonl|stderr\.txt|message\.txt))$/;
  const changes = gitOutput(['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean);
  if (
    changes.some((line) => {
      if (!line.startsWith(`?? ${outputPrefix}`)) {
        return true;
      }
      return !allowedOutput.test(line.slice(`?? ${outputPrefix}`.length));
    })
  ) {
    throw new Error('pilot requires committed inputs; only prior raw outputs may be untracked');
  }
  const freezeBytes = readFileSync(join(outDir, 'freeze.json'));
  const descriptor = JSON.parse(freezeBytes.toString('utf8'));
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
  const result = await runCase(entry.caseId, modelInvoker(outDir, entry.caseNumber));
  const record = {
    caseNumber: entry.caseNumber,
    candidateCommit,
    freezeSha256: sha256(freezeBytes),
    promptSha256: entry.promptSha256,
    model: descriptor.model,
    requestedProgram: descriptor.requestedProgram,
    cliVersion: codexVersion(),
    ...result,
  };
  writeFileSync(
    join(outDir, `case-${entry.caseNumber}-result.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, 'results.json'),
    `${JSON.stringify([...priorResults, record], null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      caseNumber,
      candidateCommit,
      freezeSha256: record.freezeSha256,
      classification: record.finalClassification,
      attempts: record.attempts.length,
      business: {
        native: record.attempts.at(-1).score.metrics.authorized_work_continues,
        acknowledgedOnce: record.attempts.at(-1).score.metrics.each_acknowledged_operation_once,
        missing: !record.attempts.at(-1).score.metrics.required_operations_present,
        duplicate: record.attempts.at(-1).score.metrics.duplicate_shipment,
        laterUpdate: record.attempts.at(-1).score.metrics.later_update_preserved,
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--out-dir');
  const outDir = index === -1 ? fileURLToPath(DEFAULT_OUT_DIR) : process.argv[index + 1];
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
