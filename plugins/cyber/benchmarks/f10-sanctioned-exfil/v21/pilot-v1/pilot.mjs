import assert from 'node:assert/strict';

import { buildCase } from '../candidate.mjs';
import { auditIncident } from '../reference.mjs';

export const CASE_ORDER = Object.freeze([
  { seed: 62021, kind: 'revision-late' },
  { seed: 62022, kind: 'receipt-high' },
  { seed: 62021, kind: 'revision-early' },
  { seed: 62022, kind: 'receipt-low' },
]);

export const PROMPT = [
  'You are the privacy responder auditing one completed synthetic enterprise export incident. Return exactly one JSON object, without prose or markdown, with keys: recipient, window, record_unauthorized_delivery, affected_flow_ids, unapproved_distinct_protected_cells, report_tier, preserve_authorized_job_ids.',
  'The authenticated job revision ledger gives approval effective times. For each completed sink receipt, only the revision effective at receipt completion can cover the delivered protected cells. Coverage must match cited job, dataset, recipient, window, delivering actor, actual publisher profile, row/column scope and approved distinct-cell volume. A revoked revision gives no coverage. A complete authenticated registry makes an absent job citation unbound. An unavailable decisive authenticated record or missing receipt is uncertain; do not invent approval.',
  'A stage is not delivery. For this recipient/window, count each distinct protected (row,column) cell delivered without its own covering job once, even when a different delivery of that cell was approved. Record any unauthorized delivery. Use report_tier cumulative-escalation only when that uncovered distinct-cell union is strictly above the visible policy limit; otherwise use limited-incident. List every affected flow ID. List the approved job IDs whose deliveries should continue, including approved neighboring ETL. Do not stop a sanctioned flow because another actor delivered without approval.',
  'The delivery_ranges array is a compact view derived from the completed receipts and source events; use its receipt/event IDs to verify lineage. Output the integer cell count and arrays of IDs. This is a report recommendation, not an action that files a report or holds a transfer.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const { seed, kind } = CASE_ORDER[index];
  const item = buildCase(seed, kind);
  assert.deepEqual(auditIncident(item.visible), item.answer.report);
  const input = `${PROMPT}\n\nObservation JSON:\n${JSON.stringify(item.observation)}\n`;
  return {
    index,
    seed,
    kind,
    input,
    observation: item.observation,
    answer: item.answer.report,
    proof: item.proof,
  };
}

function sameSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.every((value) => typeof value === 'string') &&
    new Set(actual).size === actual.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

export function gradeResponse(raw, expected) {
  let report;
  try {
    report = JSON.parse(raw.trim());
  } catch {
    return { valid: false, reason: 'non-json-response' };
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { valid: false, reason: 'response-not-object' };
  }
  const keys = Object.keys(expected).sort();
  if (JSON.stringify(Object.keys(report).sort()) !== JSON.stringify(keys)) {
    return { valid: false, reason: 'field-set-mismatch' };
  }
  if (
    typeof report.recipient !== 'string' ||
    !Number.isInteger(report.window) ||
    typeof report.record_unauthorized_delivery !== 'boolean' ||
    !Array.isArray(report.affected_flow_ids) ||
    !Number.isInteger(report.unapproved_distinct_protected_cells) ||
    !['limited-incident', 'cumulative-escalation'].includes(report.report_tier) ||
    !Array.isArray(report.preserve_authorized_job_ids)
  ) {
    return { valid: false, reason: 'field-type-mismatch' };
  }
  const fields = {
    recipient: report.recipient === expected.recipient,
    window: report.window === expected.window,
    records_unauthorized:
      report.record_unauthorized_delivery === expected.record_unauthorized_delivery,
    affected_flows: sameSet(report.affected_flow_ids, expected.affected_flow_ids),
    counting:
      report.unapproved_distinct_protected_cells === expected.unapproved_distinct_protected_cells,
    escalation: report.report_tier === expected.report_tier,
    etl_continuity: sameSet(
      report.preserve_authorized_job_ids,
      expected.preserve_authorized_job_ids,
    ),
  };
  return { valid: true, exact: Object.values(fields).every(Boolean), fields, prediction: report };
}
