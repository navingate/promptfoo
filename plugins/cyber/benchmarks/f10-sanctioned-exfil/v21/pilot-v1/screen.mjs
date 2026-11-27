#!/usr/bin/env node
import assert from 'node:assert/strict';

import { auditIncident } from '../reference.mjs';
import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

let reference = 0;
let negativeTier = 0;
let negativeEtl = 0;
for (const { index } of CASE_ORDER.map((_, index) => ({ index }))) {
  const item = buildPilotCase(index);
  assert.deepEqual(auditIncident(item.observation.capture), item.answer);
  assert.deepEqual(JSON.parse(item.input.split('Observation JSON:\n')[1]), item.observation);
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
  }) + '\n',
);
