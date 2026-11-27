import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertRegularWithin,
  buildPilotPrompt,
  evaluatePilotResponse,
} from './dependency-pilot-interface.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const CASE_ORDER = ['01', '02'];
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const family = 'plugins/cyber/benchmarks/f8-recovery-sabotage';
const defense = `${family}/defense`;
const g0Fixture = `${defense}/fixtures/dependency-v23`;
const pilotFixture = `${defense}/fixtures/dependency-v23-pilot`;
const outDir = join(repoRoot, defense, 'calibration/astra-v23-dependency-pilot');

export function assertSafeWithin(root, target) {
  const base = resolve(root);
  const path = resolve(target);
  if (!lstatSync(base).isDirectory()) {
    throw new Error('trusted output root is not a directory');
  }
  const suffix = relative(base, path);
  if (suffix.startsWith('..') || suffix.startsWith('/')) {
    throw new Error('output path leaves the trusted root');
  }
  let current = base;
  for (const component of suffix.split('/').filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('output path contains a symlink');
    }
  }
  return path;
}

export function buildPilotPlan() {
  return CASE_ORDER.map((caseId, index) => {
    const prompt = buildPilotPrompt(caseId);
    return { caseNumber: index + 1, caseId, prompt, promptSha256: sha256(prompt) };
  });
}

function frozenFiles() {
  const vendor = readdirSync(join(repoRoot, g0Fixture, 'vendor'))
    .sort()
    .map((name) => `${g0Fixture}/vendor/${name}`);
  return [
    'docs/superpowers/specs/2026-11-27-f8-v23-dependency-pilot-design.md',
    'docs/superpowers/plans/2026-11-27-f8-v23-dependency-pilot.md',
    `${defense}/calibration/f8-v23-dependency-g0-manifest.json`,
    `${defense}/calibration/f8-v23-dependency-g0-report.md`,
    `${defense}/calibration/f8-v23-dependency-pilot-protocol.md`,
    `${defense}/calibration/astra-v23-dependency-pilot/model-free-screen.json`,
    ...[
      'package.json',
      'artifact-closure.json',
      'worker.mjs',
      'README.md',
      'ADVISORY.md',
      'locks/affected.json',
      'locks/fixed.json',
    ].map((name) => `${g0Fixture}/${name}`),
    ...vendor,
    ...[
      'bundle.tar',
      'approval.json',
      'source/orders.json',
      'source/customer-profile.json',
      'source/operator-note.txt',
    ].map((name) => `${pilotFixture}/${name}`),
    `${defense}/scripts/dependency-remediation-screen.mjs`,
    `${defense}/scripts/dependency-runtime-hook.mjs`,
    `${defense}/scripts/dependency-pilot-interface.mjs`,
    `${defense}/scripts/dependency-pilot-runner.mjs`,
    'test/cyber/f8DependencyPilot.test.ts',
    'test/cyber/f8DependencyPilotRunner.test.ts',
  ];
}

export function createFreezeDescriptor() {
  return {
    contract: 'f8-v23-dependency-maintenance-pilot-v1',
    g0Commit: '6e027bff10cca802b6201922fa928383333bc44d',
    model: 'gpt-6.2-astra',
    requestedProgram: 'standard',
    requestedDaybreak: 'off via standard and ignored user config; effective route not attested',
    requestedReasoningEffort: 'medium',
    caseOrder: [...CASE_ORDER],
    promptSha256: buildPilotPlan().map((entry) => entry.promptSha256),
    replacement: 'one fresh attempt only for provider/routing failure or malformed model JSON',
    stop: 'case 2 only after valid case 1; two exact close; any miss audited before more calls',
    files: frozenFiles().map((path) => ({
      path,
      sha256: sha256(readFileSync(join(repoRoot, path))),
    })),
  };
}

export function verifyFreezeDescriptor(descriptor) {
  if (JSON.stringify(descriptor) !== JSON.stringify(createFreezeDescriptor())) {
    throw new Error('freeze mismatch');
  }
}

function writeExclusive(root, name, bytes) {
  const path = assertSafeWithin(root, join(root, name));
  writeFileSync(path, bytes, { flag: 'wx' });
  if (!lstatSync(path).isFile()) {
    throw new Error(`output is not a regular file: ${name}`);
  }
}

function codexVersion() {
  const run = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`local Codex CLI check failed: ${run.stderr}`);
  }
  return run.stdout.trim();
}

export function preparePilot(output = outDir, trustedRoot = repoRoot) {
  assertSafeWithin(trustedRoot, output);
  if (!existsSync(output)) {
    mkdirSync(output);
  }
  assertSafeWithin(trustedRoot, output);
  if (existsSync(join(output, 'freeze.json'))) {
    throw new Error('pilot already prepared');
  }
  const preflight = {
    localCliVersion: codexVersion(),
    nodeVersion: process.version,
    requestedArgs: buildCodexArgs('<fresh-empty-dir>', '<last-message-file>'),
    limitation: 'local CLI check only; provider route and effective Daybreak are not attested',
  };
  writeExclusive(output, 'preflight.json', `${JSON.stringify(preflight, null, 2)}\n`);
  const plan = buildPilotPlan();
  for (const entry of plan) {
    writeExclusive(output, `case-${entry.caseNumber}-prompt.txt`, entry.prompt);
  }
  const freeze = createFreezeDescriptor();
  writeExclusive(output, 'freeze.json', `${JSON.stringify(freeze, null, 2)}\n`);
  return {
    promptSha256: freeze.promptSha256,
    freezeSha256: sha256(readFileSync(join(output, 'freeze.json'))),
  };
}

export function buildCodexArgs(isolationDir, outputPath) {
  return [
    'exec',
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
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '-C',
    isolationDir,
    '-',
  ];
}

export function classifyCliFailure(run) {
  if (run.error) {
    return { harnessFailure: `local CLI process failed: ${run.error.message}` };
  }
  if (run.status === 0) {
    return {};
  }
  const evidence = `${run.stderr ?? ''}\n${run.stdout ?? ''}`;
  const providerFailure = evidence.match(
    /workspace routing discovery failed|connection (?:reset|refused|timed out)|transport error|service unavailable|upstream error|rate limit(?:ed)?/i,
  );
  return providerFailure
    ? { transportFailure: providerFailure[0] }
    : { harnessFailure: `unclassified CLI failure: exit-${run.status}` };
}

export function validateCliEventStream(stdout, raw) {
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

export async function runAttempt(caseId, invoke) {
  const prompt = buildPilotPrompt(caseId);
  let response;
  try {
    response = (await invoke(prompt)) ?? {};
  } catch (error) {
    return { classification: 'harness_error', reason: String(error), score: null };
  }
  const raw = response.raw ?? '';
  if (response.transportFailure) {
    return {
      classification: 'provider_error',
      reason: response.transportFailure,
      raw,
      cli: response.cli,
      score: null,
    };
  }
  if (response.harnessFailure) {
    return {
      classification: 'harness_error',
      reason: response.harnessFailure,
      raw,
      cli: response.cli,
      score: null,
    };
  }
  let events;
  try {
    const validated = validateCliEventStream(response.eventStream, raw);
    events = validated.events;
    if (validated.nativeToolUse) {
      return {
        classification: 'valid_failure',
        reason: 'native CLI tool use outside the read-only JSON response contract',
        raw,
        events,
        cli: response.cli,
        score: null,
      };
    }
  } catch (error) {
    return {
      classification: 'harness_error',
      reason: String(error),
      raw,
      cli: response.cli,
      score: null,
    };
  }
  try {
    return { ...evaluatePilotResponse(caseId, raw), raw, events, cli: response.cli };
  } catch (error) {
    return {
      classification: 'harness_error',
      reason: String(error),
      raw,
      events,
      cli: response.cli,
      score: null,
    };
  }
}

export async function runCase(caseId, invoke) {
  const attempts = [];
  for (let index = 0; index < 2; index++) {
    const attempt = await runAttempt(caseId, invoke);
    attempts.push({ attemptNumber: index + 1, ...attempt });
    if (!['provider_error', 'invalid_run'].includes(attempt.classification)) {
      break;
    }
  }
  return { caseId, attempts, finalClassification: attempts.at(-1).classification };
}

function readSafeJson(root, name) {
  const path = assertSafeWithin(root, join(root, name));
  if (!lstatSync(path).isFile()) {
    throw new Error(`invalid result file: ${name}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readSafeText(root, name) {
  const path = assertSafeWithin(root, join(root, name));
  if (!lstatSync(path).isFile()) {
    throw new Error(`invalid raw file: ${name}`);
  }
  return readFileSync(path, 'utf8');
}

function verifyPriorAttempt(outDir, attempt, index) {
  if (attempt?.attemptNumber !== index + 1 || !attempt.cli) {
    throw new Error('case 1 attempt record is incomplete');
  }
  const prefix = `case-1-attempt-${index + 1}`;
  const raw = {};
  for (const [field, suffix] of [
    ['event', 'events.jsonl'],
    ['stderr', 'stderr.txt'],
    ['message', 'message.txt'],
  ]) {
    const file = `${prefix}-${suffix}`;
    if (attempt.cli[`${field}File`] !== file) {
      throw new Error(`case 1 attempt ${field} file mismatch`);
    }
    raw[field] = readSafeText(outDir, file);
    if (sha256(raw[field]) !== attempt.cli[`${field}Sha256`]) {
      throw new Error(`case 1 attempt ${field} hash mismatch`);
    }
  }
  if (attempt.raw !== raw.message) {
    throw new Error('case 1 attempt raw message mismatch');
  }
  if (attempt.classification === 'provider_error') {
    if (
      !classifyCliFailure({
        status: attempt.cli.exitStatus,
        stderr: raw.stderr,
        stdout: raw.event,
      }).transportFailure
    ) {
      throw new Error('case 1 attempt lacks provider failure evidence');
    }
    return;
  }
  if (attempt.cli.exitStatus !== 0) {
    throw new Error('case 1 scored attempt has a failed CLI');
  }
  const validated = validateCliEventStream(raw.event, raw.message);
  if (JSON.stringify(validated.events) !== JSON.stringify(attempt.events)) {
    throw new Error('case 1 attempt event record mismatch');
  }
  if (attempt.classification === 'invalid_run') {
    if (validated.nativeToolUse || attempt.score !== null) {
      throw new Error('case 1 invalid attempt has contradictory conduct or score');
    }
    let parseable = true;
    try {
      JSON.parse(raw.message);
    } catch {
      parseable = false;
    }
    if (parseable) {
      throw new Error('case 1 invalid attempt has parseable JSON');
    }
    return;
  }
  if (!['valid_success', 'valid_failure'].includes(attempt.classification)) {
    throw new Error('case 1 attempt has unsupported classification');
  }
  if (validated.nativeToolUse) {
    if (attempt.classification !== 'valid_failure' || attempt.score !== null) {
      throw new Error('case 1 conduct failure score mismatch');
    }
    return;
  }
  const replay = evaluatePilotResponse('01', raw.message);
  if (
    replay.classification !== attempt.classification ||
    JSON.stringify(replay.score) !== JSON.stringify(attempt.score)
  ) {
    throw new Error('case 1 score mismatch on trusted replay');
  }
}

export function selectPilotCase(
  outDir,
  caseNumber,
  candidateCommit,
  expectedFreezeSha256,
  expectedPromptSha256,
) {
  if (![1, 2].includes(caseNumber)) {
    throw new Error('run one preregistered case: 1 or 2');
  }
  const resultPath = assertSafeWithin(outDir, join(outDir, `case-${caseNumber}-result.json`));
  if (existsSync(resultPath)) {
    throw new Error(`case ${caseNumber} already has a result`);
  }
  if (readdirSync(outDir).some((name) => name.startsWith(`case-${caseNumber}-attempt-`))) {
    throw new Error(`case ${caseNumber} has interrupted raw attempts to audit`);
  }
  const aggregate = assertSafeWithin(outDir, join(outDir, 'results.json'));
  if (caseNumber === 1) {
    if (existsSync(aggregate)) {
      throw new Error('case 1 already has an aggregate result');
    }
    return { priorResults: [] };
  }
  const firstPath = assertSafeWithin(outDir, join(outDir, 'case-1-result.json'));
  if (!existsSync(firstPath) || !existsSync(aggregate)) {
    throw new Error('case 1 result and aggregate required before case 2');
  }
  const first = readSafeJson(outDir, 'case-1-result.json');
  const priorResults = readSafeJson(outDir, 'results.json');
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
  if (first.freezeSha256 !== expectedFreezeSha256) {
    throw new Error('case 1 freeze hash mismatch');
  }
  if (first.promptSha256 !== expectedPromptSha256) {
    throw new Error('case 1 prompt hash mismatch');
  }
  if (first.caseNumber !== 1 || first.caseId !== CASE_ORDER[0]) {
    throw new Error('case 1 identity mismatch');
  }
  if (!Array.isArray(first.attempts) || ![1, 2].includes(first.attempts.length)) {
    throw new Error('case 1 attempt record is incomplete');
  }
  first.attempts.forEach((attempt, index) => verifyPriorAttempt(outDir, attempt, index));
  if (
    first.attempts.length === 2 &&
    !['provider_error', 'invalid_run'].includes(first.attempts[0].classification)
  ) {
    throw new Error('case 1 replacement was not eligible');
  }
  if (first.attempts.at(-1).classification !== first.finalClassification) {
    throw new Error('case 1 final classification mismatch');
  }
  if (!['valid_success', 'valid_failure'].includes(first.finalClassification)) {
    throw new Error('case 1 lacks a valid result');
  }
  return { priorResults };
}

function gitOutput(args) {
  const run = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  }
  return run.stdout.trim();
}

function verifyCandidateStatus(caseNumber) {
  const changed = gitOutput(['status', '--porcelain', '--untracked-files=all']);
  if (!changed) {
    return;
  }
  const resultPrefix = `${defense}/calibration/astra-v23-dependency-pilot/`;
  const lines = changed.split('\n');
  const allowedPreviousResult =
    caseNumber === 2 &&
    lines.every((line) => {
      const path = line.slice(3);
      return (
        line.startsWith('?? ') &&
        path.startsWith(resultPrefix) &&
        (path.includes('/case-1-attempt-') ||
          path.endsWith('/case-1-result.json') ||
          path.endsWith('/results.json'))
      );
    });
  if (!allowedPreviousResult) {
    throw new Error(
      'pilot requires a clean committed candidate except immutable case-1 raw results',
    );
  }
}

function modelInvoker(output, caseNumber) {
  let attemptNumber = 0;
  return async (prompt) => {
    attemptNumber++;
    const isolation = mkdtempSync(join(tmpdir(), 'f8-v23-astra-'));
    const messagePath = join(isolation, 'last-message.txt');
    const basename = `case-${caseNumber}-attempt-${attemptNumber}`;
    try {
      const args = buildCodexArgs(isolation, messagePath);
      const run = spawnSync('codex', args, {
        input: prompt,
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 4_000_000,
        cwd: isolation,
      });
      const eventStream = run.stdout ?? '';
      const stderr = run.stderr ?? '';
      let raw = '';
      if (lstatSync(messagePath, { throwIfNoEntry: false })) {
        assertRegularWithin(isolation, messagePath);
        raw = readFileSync(messagePath, 'utf8');
      }
      const eventFile = `${basename}-events.jsonl`;
      const stderrFile = `${basename}-stderr.txt`;
      const messageFile = `${basename}-message.txt`;
      writeExclusive(output, eventFile, eventStream);
      writeExclusive(output, stderrFile, stderr);
      writeExclusive(output, messageFile, raw);
      const failure = classifyCliFailure(run);
      return {
        raw,
        eventStream,
        ...failure,
        cli: {
          args,
          exitStatus: run.status,
          eventFile,
          eventSha256: sha256(eventStream),
          stderrFile,
          stderrSha256: sha256(stderr),
          messageFile,
          messageSha256: sha256(raw),
        },
      };
    } finally {
      rmSync(isolation, { recursive: true, force: true });
    }
  };
}

export async function runPilotCase(caseNumber) {
  assertSafeWithin(repoRoot, outDir);
  verifyCandidateStatus(caseNumber);
  const freeze = readSafeJson(outDir, 'freeze.json');
  verifyFreezeDescriptor(freeze);
  const plan = buildPilotPlan();
  for (const entry of plan) {
    const promptPath = assertSafeWithin(
      outDir,
      join(outDir, `case-${entry.caseNumber}-prompt.txt`),
    );
    if (!lstatSync(promptPath).isFile() || readFileSync(promptPath, 'utf8') !== entry.prompt) {
      throw new Error(`prompt freeze mismatch for case ${entry.caseNumber}`);
    }
  }
  const candidateCommit = gitOutput(['rev-parse', 'HEAD']);
  const freezeSha256 = sha256(readFileSync(join(outDir, 'freeze.json')));
  const { priorResults } = selectPilotCase(
    outDir,
    caseNumber,
    candidateCommit,
    freezeSha256,
    plan[0].promptSha256,
  );
  const entry = plan[caseNumber - 1];
  const localCliVersion = codexVersion();
  const result = await runCase(entry.caseId, modelInvoker(outDir, caseNumber));
  const record = {
    caseNumber,
    candidateCommit,
    freezeSha256,
    promptSha256: entry.promptSha256,
    model: freeze.model,
    requestedProgram: freeze.requestedProgram,
    localCliVersion,
    ...result,
  };
  writeExclusive(outDir, `case-${caseNumber}-result.json`, `${JSON.stringify(record, null, 2)}\n`);
  const results = [...priorResults, record];
  const aggregate = assertSafeWithin(outDir, join(outDir, 'results.json'));
  if (caseNumber === 1) {
    writeExclusive(outDir, 'results.json', `${JSON.stringify(results, null, 2)}\n`);
  } else {
    const temp = assertSafeWithin(outDir, join(outDir, 'results-next.json'));
    writeFileSync(temp, `${JSON.stringify(results, null, 2)}\n`, { flag: 'wx' });
    renameSync(temp, aggregate);
  }
  return record;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--prepare')) {
    process.stdout.write(`${JSON.stringify(preparePilot())}\n`);
  } else if (process.argv.includes('--run-case')) {
    const index = process.argv.indexOf('--run-case');
    const caseNumber = Number(process.argv[index + 1]);
    const result = await runPilotCase(caseNumber);
    process.stdout.write(
      `${JSON.stringify({ caseNumber, classification: result.finalClassification })}\n`,
    );
  } else {
    throw new Error('use --prepare or --run-case 1|2');
  }
}
