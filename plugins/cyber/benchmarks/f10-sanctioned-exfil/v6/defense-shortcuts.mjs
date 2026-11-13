#!/usr/bin/env node
// Model-free heuristics use only the frozen model-visible native captures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreDefense } from '../v3/defense.mjs';
import { loadBatch } from './capture-consumer.mjs';
import { CAPTURE_SEEDS } from './capture-producer.mjs';

function flowEvents(capture, flow) {
  return capture.events.filter(
    (event) =>
      event.actor.identity === flow.identity &&
      event.destination === flow.destination &&
      Math.floor(event.event_time / capture.policy.window_size) === flow.window &&
      event.resource.classification === 'protected' &&
      event.volume.columns.some(
        (column) => capture.catalog.columns[column]?.classification === 'protected',
      ),
  );
}

function citedJobCovers(capture, event) {
  const job = capture.job_registry.find((candidate) => candidate.job_id === event.job_ref);
  return Boolean(
    job &&
      job.dataset === event.resource.dataset &&
      job.destination === event.destination &&
      job.window === Math.floor(event.event_time / capture.policy.window_size) &&
      job.actor_binding.includes(event.actor.identity) &&
      job.approved_cell_volume >= event.volume.cells,
  );
}

export function shortcutLabels(batch, rule) {
  if (!['uncovered-any', 'cited-job-presence'].includes(rule)) {
    throw new Error(`unknown defense shortcut: ${rule}`);
  }
  const labels = {};
  for (const capture of batch.captures) {
    for (const flow of capture.flows) {
      const events = flowEvents(capture, flow);
      if (events.length === 0) {
        labels[flow.flow_id] = 'benign';
      } else if (rule === 'uncovered-any') {
        labels[flow.flow_id] = events.some((event) => !citedJobCovers(capture, event))
          ? 'cumulative-exfil'
          : 'sanctioned-bulk';
      } else {
        labels[flow.flow_id] = events.some((event) => !event.job_ref)
          ? 'cumulative-exfil'
          : 'sanctioned-bulk';
      }
    }
  }
  return labels;
}

export function auditShortcuts(seeds = CAPTURE_SEEDS) {
  const rules = ['uncovered-any', 'cited-job-presence'];
  return Object.fromEntries(
    rules.map((rule) => {
      const scores = seeds.map((seed) => {
        const batch = loadBatch(seed);
        return { seed, ...scoreDefense(batch, shortcutLabels(batch, rule)) };
      });
      return [
        rule,
        {
          valid: scores.filter((score) => score.valid).length,
          exact: scores.filter((score) => score.exact).length,
          true_positives: scores.reduce((sum, score) => sum + score.true_positives, 0),
          false_positives: scores.reduce((sum, score) => sum + score.false_positives, 0),
          false_negatives: scores.reduce((sum, score) => sum + score.false_negatives, 0),
          scores,
        },
      ];
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = auditShortcuts();
  for (const [rule, result] of Object.entries(summary)) {
    process.stdout.write(
      `${rule}: valid=${result.valid}/12 exact=${result.exact}/12 tp=${result.true_positives} fp=${result.false_positives} fn=${result.false_negatives}\n`,
    );
  }
}
