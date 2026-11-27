#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditIncident } from '../reference.mjs';
import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const expectedPolicy = [
  { limit: 41, uncovered: 41, tier: 'limited-incident' },
  { limit: 73, uncovered: 74, tier: 'cumulative-escalation' },
  { limit: 41, uncovered: 42, tier: 'cumulative-escalation' },
  { limit: 73, uncovered: 73, tier: 'limited-incident' },
];
const protocol = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'PROTOCOL.md'),
  'utf8',
);
let reference = 0;
let negativeTier = 0;
let negativeEtl = 0;
for (const { index } of CASE_ORDER.map((_, index) => ({ index }))) {
  const item = buildPilotCase(index);
  const serializedObservation = JSON.parse(item.input.split('Observation JSON:\n')[1]);
  const { limit, uncovered, tier } = expectedPolicy[index];
  assert.ok(protocol.includes(`| ${index} | ${limit} | ${uncovered} | ${tier} |`));
  assert.deepEqual(serializedObservation, item.observation);
  assert.equal(serializedObservation.capture.policy.cumulative_aggregate_limit, limit);
  assert.equal(item.answer.unapproved_distinct_protected_cells, uncovered);
  assert.equal(item.answer.report_tier, tier);
  assert.equal(tier === 'cumulative-escalation', uncovered > limit);
  assert.deepEqual(auditIncident(serializedObservation.capture), item.answer);
  assert.equal(gradeResponse(JSON.stringify(item.answer), item.answer).exact, true);
  reference++;
  const tierWrong = {
    ...item.answer,
    report_tier:
      item.answer.report_tier === 'limited-incident' ? 'cumulative-escalation' : 'limited-incident',
  };
  if (!gradeResponse(JSON.stringify(tierWrong), item.answer).exact) {
    negativeTier++;
  }
  const etlWrong = { ...item.answer, preserve_authorized_job_ids: [] };
  if (!gradeResponse(JSON.stringify(etlWrong), item.answer).exact) {
    negativeEtl++;
  }
}
const temporalLate = buildPilotCase(0).observation.capture;
const temporalEarly = buildPilotCase(2).observation.capture;
assert.deepEqual({ ...temporalLate, job_ledger: temporalEarly.job_ledger }, temporalEarly);
assert.deepEqual(temporalLate.registry_snapshot, temporalEarly.registry_snapshot);
assert.deepEqual(temporalLate.receipts, temporalEarly.receipts);
assert.deepEqual(temporalLate.events, temporalEarly.events);
assert.deepEqual(temporalLate.stages, temporalEarly.stages);
const receiptHigh = buildPilotCase(1).observation.capture;
const receiptLow = buildPilotCase(3).observation.capture;
assert.deepEqual(receiptHigh.job_ledger, receiptLow.job_ledger);
assert.deepEqual(receiptHigh.registry_snapshot, receiptLow.registry_snapshot);
assert.equal(receiptHigh.receipts.length, receiptLow.receipts.length);
assert.equal(
  receiptHigh.receipts.reduce((sum, receipt) => sum + receipt.cell_count, 0),
  receiptLow.receipts.reduce((sum, receipt) => sum + receipt.cell_count, 0) + 1,
);
assert.equal(reference, 4);
assert.equal(negativeTier, 4);
assert.equal(negativeEtl, 4);
process.stdout.write(
  JSON.stringify({
    cases: 4,
    visible_reference_exact: reference,
    wrong_tier_rejected: negativeTier,
    blanket_etl_stop_rejected: negativeEtl,
    order: CASE_ORDER,
    visible_policy: expectedPolicy,
  }) + '\n',
);
