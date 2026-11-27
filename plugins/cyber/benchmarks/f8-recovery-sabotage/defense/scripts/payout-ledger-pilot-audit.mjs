import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyToolCall, createBlindPrompt } from './payout-ledger-pilot-interface.mjs';
import {
  createOutboxLedgerPilotIncident,
  loadOutboxLedgerPilot,
} from './payout-ledger-pilot-recovery.mjs';
import { buildPilotPlan, verifyFreezeDescriptor } from './payout-ledger-pilot-runner.mjs';

const DIR = fileURLToPath(new URL('../calibration/astra-v15-outbox-pilot/', import.meta.url));
const CANDIDATE_COMMIT = '389e36afff1f2b69c6e230596ee744bd8c15a31a';
const RESULTS_SHA256 = '72a87d436f0a22f5f47892648a8fb6e029fa5b187bf1ac38f46f3dc29a360d24';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const read = (path) => readFileSync(join(DIR, path), 'utf8');

export function auditPilot() {
  verifyFreezeDescriptor(JSON.parse(read('freeze.json')));
  assert.equal(sha256(read('results.json')), RESULTS_SHA256);
  const plan = buildPilotPlan();
  const records = JSON.parse(read('results.json'));
  const fixture = loadOutboxLedgerPilot().fixture;
  assert.equal(records.length, plan.length);
  const cases = records.map((record, index) => {
    const entry = plan[index];
    assert.equal(record.caseId, entry.caseId);
    assert.equal(record.caseNumber, entry.caseNumber);
    assert.equal(record.candidateCommit, CANDIDATE_COMMIT);
    assert.equal(record.promptSha256, entry.promptSha256);
    assert.equal(read(`case-${entry.caseNumber}-prompt.txt`), entry.prompt);
    assert.deepEqual(JSON.parse(read(`case-${entry.caseNumber}-result.json`)), record);
    assert.equal(record.model, 'gpt-6.2-astra');
    assert.equal(record.requestedProgram, 'standard');
    assert.equal(record.finalClassification, 'valid_success');
    assert.equal(record.attempts.length, 1);
    const attempt = record.attempts[0];
    assert.equal(attempt.classification, 'valid_success');
    assert.equal(attempt.transportFailure, undefined);
    assert.equal(attempt.protocolFailure, undefined);
    const incident = createOutboxLedgerPilotIncident(entry.caseId);
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
      assert.ok(turn.cli.args.includes('--ignore-user-config'));
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
    const selected = fixture.cases.find((row) => row.case_id === entry.caseId);
    const pair = fixture.pairs.find((row) => row.pair_id === selected.pair_id);
    const contested = pair.common.processor_initial.find(
      (row) => row.status === 'rejected_before_settlement',
    );
    const inFlight = pair.common.processor_initial.find(
      (row) => row.status === 'accepted_in_flight',
    );
    const metrics = attempt.score.metrics;
    return {
      case_number: entry.caseNumber,
      case_id: entry.caseId,
      prompt_sha256: entry.promptSha256,
      valid_turns: attempt.turns.length,
      exact_outcome: attempt.score.outcome,
      current_contested_ap_status: selected.current_contested_revision.status,
      in_flight_reference: inFlight.reference,
      contested_reference: contested.reference,
      original_in_flight_actual_receipts: metrics.settlements.filter(
        (row) => row.reference === inFlight.reference && row.origin === 'original-in-flight',
      ).length,
      projected_in_flight_receipts_at_scoring: metrics.scheduled_in_flight_count,
      contested_settlement_count: metrics.settlement_counts[contested.reference],
      fresh_settlement_count: metrics.settlement_counts[pair.common.new_due_payout.reference],
      unauthorized_disbursements: metrics.unauthorized_disbursements,
      duplicate_references: metrics.duplicate_references,
      unpaid_due: metrics.unpaid_due,
      contested_outbox_closed: metrics.b_outbox_closed,
      continuity_paid: metrics.continuity_paid,
      reported_disposition: metrics.reported_disposition,
      business_outcome: metrics.business_outcome,
      actions: attempt.turns.map((turn) => turn.action.tool),
    };
  });
  assert.equal(new Set(records.map((entry) => entry.attempts[0].threadId)).size, plan.length);
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
