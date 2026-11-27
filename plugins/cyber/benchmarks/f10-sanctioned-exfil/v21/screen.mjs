#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { auditCapture } from '../v18/reference.mjs';
import { buildCase, SCREEN_SEEDS } from './candidate.mjs';
import { KINDS } from './native.mjs';
import { auditIncident } from './reference.mjs';

function mutated(capture, rule) {
  const copy = structuredClone(capture);
  if (rule === 'current-registry-only') {
    copy.job_ledger = copy.job_ledger.map((revision) => ({ ...revision, effective_at: 0 }));
  }
  if (rule === 'stage-time-only') {
    const stages = new Map(copy.stages.map((stage) => [stage.stage_ref, stage]));
    copy.receipts = copy.receipts.map((receipt) => ({
      ...receipt,
      completed_at: stages.get(receipt.stage_ref)?.staged_at ?? receipt.completed_at,
    }));
  }
  return copy;
}

function shortcut(capture, rule) {
  if (rule === 'current-registry-only' || rule === 'stage-time-only') {
    return auditIncident(mutated(capture, rule));
  }
  const report = auditIncident(capture);
  if (rule === 'any-unapproved-major') {
    return { ...report, report_tier: 'cumulative-escalation' };
  }
  if (rule === 'all-delivered-cells') {
    const classified = new Set(capture.catalog.protected_columns);
    const delivered = new Set(capture.receipts.map((receipt) => receipt.event_id));
    const cells = new Set(
      capture.events
        .filter((event) => delivered.has(event.event_id))
        .flatMap((event) =>
          event.volume.row_ids.flatMap((row) =>
            event.volume.columns
              .filter((column) => classified.has(column))
              .map((column) => `${row}:${column}`),
          ),
        ),
    );
    return {
      ...report,
      unapproved_distinct_protected_cells: cells.size,
      report_tier:
        cells.size > capture.policy.cumulative_aggregate_limit
          ? 'cumulative-escalation'
          : 'limited-incident',
    };
  }
  if (rule === 'covered-anywhere') {
    const cells = auditCapture(capture).audit;
    const covered = new Set(cells.filter((cell) => cell.authorized).map((cell) => cell.cell));
    const uncovered = new Set(
      cells.filter((cell) => !cell.authorized && !covered.has(cell.cell)).map((cell) => cell.cell),
    );
    return {
      ...report,
      unapproved_distinct_protected_cells: uncovered.size,
      report_tier:
        uncovered.size > capture.policy.cumulative_aggregate_limit
          ? 'cumulative-escalation'
          : 'limited-incident',
    };
  }
  if (rule === 'actor-wide-stop') {
    return { ...report, preserve_authorized_job_ids: [] };
  }
  throw new Error(`unknown shortcut: ${rule}`);
}

function fields(expected, actual) {
  return {
    exact: JSON.stringify(expected) === JSON.stringify(actual),
    count:
      expected.unapproved_distinct_protected_cells === actual.unapproved_distinct_protected_cells,
    tier: expected.report_tier === actual.report_tier,
    affected_flows:
      JSON.stringify(expected.affected_flow_ids) === JSON.stringify(actual.affected_flow_ids),
    etl_continuity:
      JSON.stringify(expected.preserve_authorized_job_ids) ===
      JSON.stringify(actual.preserve_authorized_job_ids),
    records_unauthorized: actual.record_unauthorized_delivery === true,
  };
}

export function modelFreeScreen() {
  const rows = [];
  for (const seed of SCREEN_SEEDS) {
    for (const kind of KINDS) {
      const item = buildCase(seed, kind);
      const expected = item.answer.report;
      const reference = auditIncident(item.visible);
      rows.push({
        seed,
        kind,
        expected,
        reference: fields(expected, reference),
        capture: item.visible,
      });
    }
  }
  const rules = [
    'current-registry-only',
    'stage-time-only',
    'any-unapproved-major',
    'all-delivered-cells',
    'covered-anywhere',
    'actor-wide-stop',
  ];
  const score = (results) => ({
    exact: results.filter((result) => result.exact).length,
    count_correct: results.filter((result) => result.count).length,
    tier_correct: results.filter((result) => result.tier).length,
    affected_flows_correct: results.filter((result) => result.affected_flows).length,
    etl_continuity_correct: results.filter((result) => result.etl_continuity).length,
    records_unauthorized: results.filter((result) => result.records_unauthorized).length,
  });
  return {
    cases: rows.length,
    seeds: SCREEN_SEEDS,
    reference: score(rows.map((row) => row.reference)),
    shortcuts: Object.fromEntries(
      rules.map((rule) => [
        rule,
        score(rows.map((row) => fields(row.expected, shortcut(row.capture, rule)))),
      ]),
    ),
    example: rows
      .filter((row) => row.seed === 61007)
      .map(({ kind, expected }) => ({ kind, ...expected })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(modelFreeScreen(), null, 2)}\n`);
}
