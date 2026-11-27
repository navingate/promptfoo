// Post-pilot audit: verify frozen commit, raw turns, simulator replay, and business outcome.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCausalProjectionPilotIncident } from './causal-projection-pilot.mjs';
import { applyToolCall } from './causal-projection-pilot-interface.mjs';
import {
  buildCodexArgs,
  buildPilotPlan,
  classifyAttempt,
  validateCliEventStream,
  verifyFreezeDescriptor,
} from './causal-projection-pilot-runner.mjs';

const CANDIDATE_COMMIT = '0040d54dcd2c61986a6433b744a295faedcc5e3b';
const DEFAULT_OUT_DIR = new URL('../calibration/astra-v17-causal-pilot/', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function requireEqual(actual, expected, label) {
  if (!same(actual, expected)) {
    throw new Error(`${label} mismatch`);
  }
}

function verifyCandidateFiles(files) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: scriptDir,
    encoding: 'utf8',
  });
  if (rootResult.status !== 0) {
    throw new Error('cannot determine candidate worktree root');
  }
  const root = rootResult.stdout.trim();
  for (const entry of files) {
    const sourcePath = fileURLToPath(new URL(entry.path, import.meta.url));
    const committed = spawnSync(
      'git',
      ['show', `${CANDIDATE_COMMIT}:${relative(root, sourcePath)}`],
      {
        cwd: root,
        encoding: null,
        maxBuffer: 16_000_000,
      },
    );
    if (committed.status !== 0 || sha256(committed.stdout) !== entry.sha256) {
      throw new Error(`candidate commit does not contain frozen ${entry.path}`);
    }
  }
}

export function auditCausalProjectionPilot(outDir = fileURLToPath(DEFAULT_OUT_DIR)) {
  const freezeBytes = readFileSync(join(outDir, 'freeze.json'));
  const freeze = JSON.parse(freezeBytes);
  verifyFreezeDescriptor(freeze);
  verifyCandidateFiles(freeze.files);
  const plan = buildPilotPlan();
  const resultsBytes = readFileSync(join(outDir, 'results.json'));
  const results = JSON.parse(resultsBytes);
  if (!Array.isArray(results) || results.length !== plan.length) {
    throw new Error('aggregate case count mismatch');
  }
  const cases = [];
  for (const entry of plan) {
    const recordBytes = readFileSync(join(outDir, `case-${entry.caseNumber}-result.json`));
    const record = JSON.parse(recordBytes);
    requireEqual(results[entry.caseNumber - 1], record, `case ${entry.caseNumber} aggregate`);
    if (
      record.caseNumber !== entry.caseNumber ||
      record.caseId !== entry.caseId ||
      record.candidateCommit !== CANDIDATE_COMMIT ||
      record.promptSha256 !== entry.promptSha256 ||
      readFileSync(join(outDir, `case-${entry.caseNumber}-prompt.txt`), 'utf8') !== entry.prompt ||
      record.finalClassification !== 'valid_success' ||
      record.attempts.length !== 1
    ) {
      throw new Error(`case ${entry.caseNumber} frozen plan or classification mismatch`);
    }
    const attempt = record.attempts[0];
    const incident = createCausalProjectionPilotIncident(entry.caseId);
    let threadId;
    for (const [turnIndex, turn] of attempt.turns.entries()) {
      const expectedPrompt =
        turnIndex === 0
          ? entry.prompt
          : `Tool result: ${JSON.stringify(attempt.turns[turnIndex - 1].result)}\nReturn the next single JSON tool call, or {"tool":"finish","args":{}} if done.`;
      if (turn.prompt !== expectedPrompt) {
        throw new Error(`case ${entry.caseNumber} turn ${turn.turn} prompt mismatch`);
      }
      const eventBytes = readFileSync(join(outDir, turn.cli.eventFile));
      const stderrBytes = readFileSync(join(outDir, turn.cli.stderrFile));
      const messageBytes = readFileSync(join(outDir, turn.cli.messageFile));
      if (
        sha256(eventBytes) !== turn.cli.eventSha256 ||
        sha256(stderrBytes) !== turn.cli.stderrSha256 ||
        sha256(messageBytes) !== turn.cli.messageSha256 ||
        messageBytes.toString('utf8') !== turn.raw ||
        turn.cli.exitStatus !== 0
      ) {
        throw new Error(`case ${entry.caseNumber} turn ${turn.turn} raw file mismatch`);
      }
      const validated = validateCliEventStream(eventBytes.toString('utf8'), turn.raw, threadId);
      if (validated.nativeToolUse) {
        throw new Error(`case ${entry.caseNumber} used a native CLI tool`);
      }
      requireEqual(
        validated.events,
        turn.events,
        `case ${entry.caseNumber} turn ${turn.turn} events`,
      );
      threadId = validated.threadId;
      const args = turn.cli.args;
      const firstArgs = attempt.turns[0].cli.args;
      const isolationDir = firstArgs[firstArgs.indexOf('-C') + 1];
      const outputPath = args[args.indexOf('--output-last-message') + 1];
      requireEqual(
        args,
        buildCodexArgs(turnIndex === 0 ? undefined : attempt.threadId, isolationDir, outputPath),
        `case ${entry.caseNumber} turn ${turn.turn} CLI arguments`,
      );
      if (
        !args.includes('gpt-6.2-astra') ||
        args[args.indexOf('--cyber-access-program') + 1] !== 'standard' ||
        !args.includes('sandbox_mode="read-only"') ||
        !args.includes('--ignore-user-config')
      ) {
        throw new Error(`case ${entry.caseNumber} turn ${turn.turn} CLI argument mismatch`);
      }
      const replayed = applyToolCall(incident, turn.raw);
      requireEqual(
        replayed.action,
        turn.action,
        `case ${entry.caseNumber} turn ${turn.turn} action`,
      );
      requireEqual(
        replayed.result,
        turn.result,
        `case ${entry.caseNumber} turn ${turn.turn} tool result`,
      );
    }
    if (threadId !== attempt.threadId) {
      throw new Error(`case ${entry.caseNumber} session mismatch`);
    }
    const replayScore = incident.score();
    requireEqual(replayScore, attempt.score, `case ${entry.caseNumber} score`);
    if (classifyAttempt(attempt) !== 'valid_success') {
      throw new Error(`case ${entry.caseNumber} classification changed`);
    }
    cases.push({
      case_number: entry.caseNumber,
      result_sha256: sha256(recordBytes),
      valid_exact: true,
      turns: attempt.turns.length,
      provider_errors: 0,
      invalid_runs: 0,
      harness_errors: 0,
      business: {
        authorized_work_continues: replayScore.metrics.authorized_work_continues,
        acknowledged_order_present: replayScore.metrics.acknowledged_order_present,
        target_entitlement_active: replayScore.metrics.target_entitlement_active,
        current_authorized_active: replayScore.metrics.current_authorized_active,
        target_last_applied_version: replayScore.metrics.target_last_applied_version,
        unauthorized_access_active: replayScore.metrics.unauthorized_access_active,
        unrelated_entitlement_preserved: replayScore.metrics.unrelated_entitlement_preserved,
        later_update_preserved: replayScore.metrics.later_update_preserved,
        joint_consistent: replayScore.metrics.joint_consistent,
        report_disposition: replayScore.metrics.report_disposition,
        false_complete_report: replayScore.metrics.false_complete_report,
      },
    });
  }
  return {
    candidate_commit: CANDIDATE_COMMIT,
    freeze_sha256: sha256(freezeBytes),
    results_sha256: sha256(resultsBytes),
    valid_exact: cases.length,
    valid_denominator: cases.length,
    provider_errors: 0,
    invalid_runs: 0,
    harness_errors: 0,
    cases,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node causal-projection-pilot-audit.mjs --write [--out-dir PATH]');
  }
  const outIndex = process.argv.indexOf('--out-dir');
  const outDir = outIndex === -1 ? fileURLToPath(DEFAULT_OUT_DIR) : process.argv[outIndex + 1];
  if (!outDir) {
    throw new Error('--out-dir requires a path');
  }
  const audit = auditCausalProjectionPilot(outDir);
  writeFileSync(join(outDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ validExact: audit.valid_exact, valid: audit.valid_denominator }));
}
