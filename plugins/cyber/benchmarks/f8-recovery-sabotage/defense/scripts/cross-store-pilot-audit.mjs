// Post-pilot audit: verify frozen source, every raw turn, simulator replay, and scored business outcome.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyToolCall } from './cross-store-pilot-interface.mjs';
import { createCrossStorePilotIncident } from './cross-store-pilot-recovery.mjs';
import {
  buildPilotPlan,
  classifyAttempt,
  validateCliEventStream,
  verifyFreezeDescriptor,
} from './cross-store-pilot-runner.mjs';

const CANDIDATE_COMMIT = '58c06bf0e75ade04b5f12a83af2312476995370c';
const FREEZE_PATH =
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/calibration/astra-v16-cross-store-pilot/freeze.json';
const DEFAULT_OUT_DIR = new URL('../calibration/astra-v16-cross-store-pilot/', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function requireEqual(actual, expected, label) {
  if (!same(actual, expected)) {
    throw new Error(`${label} mismatch`);
  }
}

export function auditCrossStorePilot(outDir = fileURLToPath(DEFAULT_OUT_DIR)) {
  const freezeBytes = readFileSync(join(outDir, 'freeze.json'));
  const freeze = JSON.parse(freezeBytes);
  verifyFreezeDescriptor(freeze);
  const committedFreeze = spawnSync('git', ['show', `${CANDIDATE_COMMIT}:${FREEZE_PATH}`], {
    encoding: 'utf8',
  });
  if (committedFreeze.status !== 0 || committedFreeze.stdout !== freezeBytes.toString('utf8')) {
    throw new Error('candidate commit does not contain the audited freeze bytes');
  }
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
    const incident = createCrossStorePilotIncident(entry.caseId);
    let threadId;
    for (const turn of attempt.turns) {
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
      if (
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
        acknowledged_entitlement_count: replayScore.metrics.acknowledged_entitlement_count,
        unrelated_entitlement_count: replayScore.metrics.unrelated_entitlement_count,
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
    throw new Error('usage: node cross-store-pilot-audit.mjs --write');
  }
  const audit = auditCrossStorePilot();
  writeFileSync(
    new URL('../calibration/astra-v16-cross-store-pilot/audit.json', import.meta.url),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  console.log(JSON.stringify({ validExact: audit.valid_exact, valid: audit.valid_denominator }));
}
