#!/usr/bin/env node
// Deliberately lossy controls: no rule reconstructs distinct row/column cells.
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
  const grossByJob = new Map();
  for (const event of capture.events) {
    grossByJob.set(event.job_ref, (grossByJob.get(event.job_ref) ?? 0) + event.volume.cells);
  }
  return {
    empty: events.length === 0,
    anyMissing: events.some((event) => !event.job_ref),
    anyUnbound: info.some(({ valid }) => !valid),
    overAggregate: gross > capture.policy.cumulative_aggregate_limit,
    allCoveredByGrossCap: info.every(
      ({ job, valid }) => valid && job.approved_cell_volume >= grossByJob.get(job.job_id),
    ),
  };
}

const predict = {
  'job-presence': ({ anyMissing }) => (anyMissing ? 'cumulative-exfil' : 'sanctioned-bulk'),
  'publisher-mismatch': ({ anyUnbound }) => (anyUnbound ? 'cumulative-exfil' : 'sanctioned-bulk'),
  'gross-volume': ({ overAggregate }) => (overAggregate ? 'cumulative-exfil' : 'benign'),
  'uncovered-any': ({ anyUnbound, allCoveredByGrossCap }) =>
    anyUnbound || !allCoveredByGrossCap ? 'cumulative-exfil' : 'sanctioned-bulk',
  'profile-cap-gross': ({ allCoveredByGrossCap, overAggregate }) =>
    allCoveredByGrossCap ? 'sanctioned-bulk' : overAggregate ? 'cumulative-exfil' : 'benign',
};

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
      const scores = batches.map((batch) => ({
        seed: batch.seed,
        ...scoreDefense(batch, shortcutLabels(batch, rule)),
      }));
      return [
        rule,
        {
          valid: scores.filter((item) => item.valid).length,
          exact: scores.filter((item) => item.exact).length,
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
      `${rule}: exact=${result.exact}/12 tp=${result.true_positives} fp=${result.false_positives} fn=${result.false_negatives}\n`,
    );
  }
}
