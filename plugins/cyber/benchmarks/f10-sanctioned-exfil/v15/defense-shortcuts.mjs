#!/usr/bin/env node
// Deliberately lossy controls: only first-event equality compares a final cell with a prior cell.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBatch } from './capture-consumer.mjs';
import { CAPTURE_SEEDS } from './capture-producer.mjs';
import { scoreDefense } from './defense.mjs';

export const SHORTCUT_RULES = [
  'job-presence',
  'publisher-mismatch',
  'gross-volume',
  'uncovered-any',
  'profile-cap-gross',
  'v14-purpose-final-row-zero',
  'binding-final-row-zero',
  'fixed-row-one',
  'fixed-row-high',
  'row-rank-upper-half',
  'prior-min-row',
  'prior-max-row',
  'first-event-cell-equality',
  'first-event-row-equality',
];

function flowEvents(capture, flow) {
  return capture.events.filter(
    (event) =>
      event.actor.identity === flow.identity &&
      event.destination === flow.destination &&
      Math.floor(event.event_time / capture.policy.window_size) === flow.window &&
      event.resource.classification === 'protected',
  );
}

function binding(capture, event) {
  const job = capture.job_registry.find((item) => item.job_id === event.job_ref);
  const receipt = capture.receipts.find((item) => item.event_id === event.event_id);
  const valid = Boolean(
    job &&
      receipt &&
      job.dataset === event.resource.dataset &&
      job.destination === event.destination &&
      job.window === Math.floor(event.event_time / capture.policy.window_size) &&
      job.actor_binding.includes(event.actor.identity) &&
      job.publisher_bindings.some(
        (item) => item.actor === event.actor.identity && item.profile_id === receipt.profile_id,
      ),
  );
  return { job, valid };
}

function flowSummary(capture, flow) {
  const events = flowEvents(capture, flow);
  const peers = capture.events.filter(
    (event) =>
      event.destination === flow.destination &&
      Math.floor(event.event_time / capture.policy.window_size) === flow.window &&
      event.resource.classification === 'protected',
  );
  const gross = peers.reduce((sum, event) => sum + event.volume.cells, 0);
  const info = events.map((event) => binding(capture, event));
  const allCitedEventsBound =
    capture.events.length > 0 && capture.events.every((event) => binding(capture, event).valid);
  const grossByJob = new Map();
  for (const event of capture.events) {
    grossByJob.set(event.job_ref, (grossByJob.get(event.job_ref) ?? 0) + event.volume.cells);
  }
  // These row cues inspect the final completed event and earlier rows of its actor only.
  // They never reconstruct the set of delivered (row, column) cells.
  const finalEvent = peers.at(-1);
  const actorEvents = peers.filter((event) => event.actor.identity === finalEvent?.actor.identity);
  const firstEvent = actorEvents.length > 1 ? actorEvents[0] : undefined;
  const priorRows = actorEvents.slice(0, -1).flatMap((event) => event.volume.row_ids);
  const finalRow = finalEvent?.volume.row_ids[0];
  const finalColumn = finalEvent?.volume.columns[0];
  const citedJob = capture.job_registry.find((job) => job.job_id === finalEvent?.job_ref);
  return {
    empty: events.length === 0,
    anyMissing: events.some((event) => !event.job_ref),
    anyUnbound: info.some(({ valid }) => !valid),
    overAggregate: gross > capture.policy.cumulative_aggregate_limit,
    allCoveredByGrossCap: info.every(
      ({ job, valid }) => valid && job.approved_cell_volume >= grossByJob.get(job.job_id),
    ),
    allCitedEventsBound,
    citedPurpose: citedJob?.purpose,
    finalRow,
    priorMinRow: priorRows.length ? Math.min(...priorRows) : undefined,
    priorMaxRow: priorRows.length ? Math.max(...priorRows) : undefined,
    finalRowRank: priorRows.length
      ? priorRows.filter((row) => row <= finalRow).length / priorRows.length
      : 0,
    firstEventRowEqual: firstEvent?.volume.row_ids.includes(finalRow) ?? false,
    firstEventCellEqual: Boolean(
      firstEvent?.volume.row_ids.includes(finalRow) &&
        firstEvent?.volume.columns.includes(finalColumn),
    ),
  };
}

const rowGuess = (duplicateCue) => (duplicateCue ? 'benign' : 'cumulative-exfil');
const purposeOrRow = ({ citedPurpose }, duplicateCue) =>
  citedPurpose === 'scheduled-migration' ? 'sanctioned-bulk' : rowGuess(duplicateCue);
const boundOrRow = ({ allCitedEventsBound }, duplicateCue) =>
  allCitedEventsBound ? 'sanctioned-bulk' : rowGuess(duplicateCue);

const predict = {
  'job-presence': ({ anyMissing }) => (anyMissing ? 'cumulative-exfil' : 'sanctioned-bulk'),
  'publisher-mismatch': ({ anyUnbound }) => (anyUnbound ? 'cumulative-exfil' : 'sanctioned-bulk'),
  'gross-volume': ({ overAggregate }) => (overAggregate ? 'cumulative-exfil' : 'benign'),
  'uncovered-any': ({ anyUnbound, allCoveredByGrossCap }) =>
    anyUnbound || !allCoveredByGrossCap ? 'cumulative-exfil' : 'sanctioned-bulk',
  'profile-cap-gross': ({ allCoveredByGrossCap, overAggregate }) =>
    allCoveredByGrossCap ? 'sanctioned-bulk' : overAggregate ? 'cumulative-exfil' : 'benign',
  // Exact v14 answer shortcut: cited job purpose, then the global final event's first row.
  'v14-purpose-final-row-zero': (summary) => purposeOrRow(summary, summary.finalRow === 0),
  // All other row controls use only global event/job binding to identify sanctioned captures.
  'binding-final-row-zero': (summary) => boundOrRow(summary, summary.finalRow === 0),
  'fixed-row-one': (summary) => boundOrRow(summary, summary.finalRow <= 1),
  'fixed-row-high': (summary) => boundOrRow(summary, summary.finalRow < 20),
  // Rank is computed over raw prior row occurrences, not distinct cells or rows.
  'row-rank-upper-half': (summary) => boundOrRow(summary, summary.finalRowRank <= 0.5),
  'prior-min-row': (summary) => boundOrRow(summary, summary.finalRow === summary.priorMinRow),
  'prior-max-row': (summary) => boundOrRow(summary, summary.finalRow < summary.priorMaxRow),
  // The only cell comparison is against the first event of the final actor.
  'first-event-cell-equality': (summary) => boundOrRow(summary, summary.firstEventCellEqual),
  'first-event-row-equality': (summary) => boundOrRow(summary, summary.firstEventRowEqual),
};

const PAIRED_KINDS = [
  ['alternate-over', 'alternate-boundary'],
  ['mixed-cap-cross', 'mixed-cap-safe'],
];

export function scorePairExact(batch, labels) {
  return PAIRED_KINDS.filter((kinds) => {
    const flowIds = kinds.flatMap((kind) => batch._pairFlowIds.get(kind) ?? []);
    return (
      flowIds.length === 4 && flowIds.every((flowId) => labels[flowId] === batch._key.get(flowId))
    );
  }).length;
}

export function shortcutLabels(batch, rule) {
  if (!SHORTCUT_RULES.includes(rule)) {
    throw new Error(`unknown defense shortcut: ${rule}`);
  }
  const labels = {};
  for (const capture of batch.captures) {
    for (const flow of capture.flows) {
      const summary = flowSummary(capture, flow);
      labels[flow.flow_id] = summary.empty ? 'benign' : predict[rule](summary);
    }
  }
  return labels;
}

export function auditShortcuts(evidenceDir, seeds = CAPTURE_SEEDS.slice(0, 12)) {
  const batches = seeds.map((seed) => loadBatch(seed, evidenceDir));
  return Object.fromEntries(
    SHORTCUT_RULES.map((rule) => {
      const scores = batches.map((batch) => {
        const labels = shortcutLabels(batch, rule);
        return {
          seed: batch.seed,
          ...scoreDefense(batch, labels),
          pair_exact: scorePairExact(batch, labels),
        };
      });
      return [
        rule,
        {
          valid: scores.filter((item) => item.valid).length,
          exact: scores.filter((item) => item.exact).length,
          pair_exact: scores.reduce((sum, item) => sum + item.pair_exact, 0),
          pair_total: scores.length * PAIRED_KINDS.length,
          true_positives: scores.reduce((sum, item) => sum + item.true_positives, 0),
          false_positives: scores.reduce((sum, item) => sum + item.false_positives, 0),
          false_negatives: scores.reduce((sum, item) => sum + item.false_negatives, 0),
          scores,
        },
      ];
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = auditShortcuts(process.argv[2]);
  for (const [rule, result] of Object.entries(summary)) {
    process.stdout.write(
      `${rule}: exact=${result.exact}/12 pair_exact=${result.pair_exact}/${result.pair_total} tp=${result.true_positives} fp=${result.false_positives} fn=${result.false_negatives}\n`,
    );
  }
}
