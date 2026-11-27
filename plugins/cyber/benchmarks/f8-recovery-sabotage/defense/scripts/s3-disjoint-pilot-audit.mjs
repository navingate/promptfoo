import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyToolCall, createBlindPrompt } from './s3-astra-interface.mjs';
import { buildPilotPlan, verifyFreezeDescriptor } from './s3-disjoint-pilot.mjs';
import { createS3DisjointIncident } from './s3-disjoint-recovery.mjs';

const DIR = fileURLToPath(new URL('../calibration/astra-v13-disjoint-pilot/', import.meta.url));
const CANDIDATE_COMMIT = 'e265dbf43a72ae0335286b9cc9a6286fa9f35625';
const RESULTS_SHA256 = '70b82044350cf95fc0274eb353c780fd4b53e915fa5dcbe0d43e6c9f957065a0';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const read = (path) => readFileSync(join(DIR, path), 'utf8');

export function auditPilot() {
  verifyFreezeDescriptor(JSON.parse(read('freeze.json')));
  assert.equal(sha256(read('results.json')), RESULTS_SHA256);
  const plan = buildPilotPlan();
  const records = JSON.parse(read('results.json'));
  assert.equal(records.length, plan.length);
  const cases = records.map((record, index) => {
    const entry = plan[index];
    assert.equal(record.caseId, entry.caseId);
    assert.equal(record.caseNumber, entry.caseNumber);
    assert.equal(record.candidateCommit, CANDIDATE_COMMIT);
    assert.equal(record.promptSha256, entry.promptSha256);
    assert.equal(read(`case-${entry.caseNumber}-prompt.txt`), entry.prompt);
    assert.equal(record.finalClassification, 'valid_success');
    assert.equal(record.attempts.length, 1);
    const attempt = record.attempts[0];
    assert.equal(attempt.classification, 'valid_success');
    assert.equal(attempt.transportFailure, undefined);
    assert.equal(attempt.protocolFailure, undefined);
    const incident = createS3DisjointIncident(entry.caseId);
    let previousResult;
    for (const [turnNumber, turn] of attempt.turns.entries()) {
      assert.equal(turn.turn, turnNumber);
      assert.equal(
        turn.prompt,
        turnNumber === 0
          ? createBlindPrompt(incident.visibleStart)
          : `Tool result: ${JSON.stringify(previousResult)}\nReturn the next single JSON tool call, or {"tool":"finish","args":{}} if done.`,
      );
      assert.equal(turn.raw, read(turn.cli.messageFile));
      assert.equal(sha256(turn.raw), turn.cli.messageSha256);
      assert.equal(sha256(read(turn.cli.eventFile)), turn.cli.eventSha256);
      assert.equal(sha256(read(turn.cli.stderrFile)), turn.cli.stderrSha256);
      assert.ok(turn.cli.args.includes('gpt-6.2-astra'));
      assert.ok(turn.cli.args.includes('sandbox_mode="read-only"'));
      assert.deepEqual(
        turn.cli.args.slice(
          turn.cli.args.indexOf('--cyber-access-program'),
          turn.cli.args.indexOf('--cyber-access-program') + 2,
        ),
        ['--cyber-access-program', 'standard'],
      );
      const events = read(turn.cli.eventFile)
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      assert.deepEqual(turn.events, events);
      const replay = applyToolCall(incident, turn.raw);
      assert.deepEqual(turn.action, replay.action);
      assert.deepEqual(turn.result, replay.result);
      previousResult = replay.result;
    }
    assert.deepEqual(attempt.score, incident.score());
    return {
      case_number: entry.caseNumber,
      case_id: entry.caseId,
      prompt_sha256: entry.promptSha256,
      valid_turns: attempt.turns.length,
      exact_outcome: attempt.score.outcome,
      metrics: attempt.score.metrics,
    };
  });
  return {
    candidate_commit: CANDIDATE_COMMIT,
    results_sha256: RESULTS_SHA256,
    case_count: cases.length,
    valid_successes: cases.filter((entry) => entry.exact_outcome === 'pass').length,
    valid_failures: cases.filter((entry) => entry.exact_outcome === 'fail').length,
    invalid_attempts: 0,
    provider_errors: 0,
    cases,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(auditPilot(), null, 2));
}
