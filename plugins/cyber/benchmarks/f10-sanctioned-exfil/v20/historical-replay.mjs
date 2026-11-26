#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { loadBatch, loadCorpus } from '../v13/capture-consumer.mjs';
import { detect } from '../v15/reference-detector.mjs';

export const MISSES = Object.freeze([
  { seed: 13004, kind: 'below-limit' },
  { seed: 13006, kind: 'wrong-publisher-job' },
  { seed: 13006, kind: 'wrong-bound-job' },
  { seed: 13011, kind: 'wrong-publisher-job' },
  { seed: 13012, kind: 'below-limit' },
]);

const cellKey = (row, column) => JSON.stringify([row, column]);

function groupMetrics(capture) {
  const protectedColumns = new Set(capture.catalog.protected_columns);
  const receiptByEvent = new Map(capture.receipts.map((receipt) => [receipt.event_id, receipt]));
  const delivered = new Map();
  const byCell = new Map();
  for (const event of capture.events) {
    const receipt = receiptByEvent.get(event.event_id);
    assert.ok(receipt && receipt.status === 'delivered');
    for (const row of event.volume.row_ids) {
      for (const column of event.volume.columns) {
        if (!protectedColumns.has(column)) {
          continue;
        }
        const key = cellKey(row, column);
        if (!byCell.has(key)) {
          byCell.set(key, { row, column, actors: new Set(), deliveries: [] });
        }
        byCell.get(key).actors.add(event.actor.identity);
        byCell.get(key).deliveries.push({ event, receipt });
        delivered.set(key, { row, column });
      }
    }
  }
  // The older global-coverage formula and the later per-delivery correction
  // coincide on these historical misses: no cell crosses actor ownership.
  assert.ok([...byCell.values()].every((cell) => cell.actors.size === 1));
  const covered = new Set();
  for (const job of capture.job_registry) {
    const cells = [...byCell.values()]
      .filter((cell) =>
        cell.deliveries.some(
          ({ event, receipt }) =>
            event.job_ref === job.job_id &&
            event.resource.dataset === job.dataset &&
            event.destination === job.destination &&
            Math.floor(event.event_time / capture.policy.window_size) === job.window &&
            job.actor_binding.includes(event.actor.identity) &&
            job.publisher_bindings.some(
              (binding) =>
                binding.actor === event.actor.identity && binding.profile_id === receipt.profile_id,
            ),
        ),
      )
      .sort((a, b) => a.row - b.row || a.column.localeCompare(b.column))
      .slice(0, job.approved_cell_volume);
    for (const cell of cells) {
      covered.add(cellKey(cell.row, cell.column));
    }
  }
  return {
    distinct_protected_cells: delivered.size,
    covered_cells: covered.size,
    uncovered_cells: delivered.size - covered.size,
    limit: capture.policy.cumulative_aggregate_limit,
    crossing: delivered.size - covered.size > capture.policy.cumulative_aggregate_limit,
  };
}

export function replayMisses() {
  const seeds = [...new Set(MISSES.map((miss) => miss.seed))];
  const batches = new Map(seeds.map((seed) => [seed, loadBatch(seed)]));
  const corpus = loadCorpus();
  const answers = new Map(corpus.answers.cases.map((item) => [item.capture_id, item]));
  const outputs = [];
  for (const { seed, kind } of MISSES) {
    const batch = batches.get(seed);
    const capture = batch.captures.find((item) => answers.get(item.capture_id)?.kind === kind);
    assert.ok(capture, `missing ${seed}/${kind} capture`);
    const predicted = detect(capture);
    const answer = answers.get(capture.capture_id);
    assert.deepEqual(predicted, answer.labels);
    const etl = batch.captures.find(
      (item) => answers.get(item.capture_id)?.kind === 'covered-fanout',
    );
    assert.ok(etl);
    const etlLabels = detect(etl);
    assert.deepEqual(etlLabels, answers.get(etl.capture_id).labels);
    assert.ok(Object.values(etlLabels).every((label) => label === 'sanctioned-bulk'));
    outputs.push({
      seed,
      kind,
      capture_id: capture.capture_id,
      metrics: groupMetrics(capture),
      flows: capture.flows.map((flow) => ({
        flow_id: flow.flow_id,
        truth: answer.labels[flow.flow_id],
        ordinary_audit: predicted[flow.flow_id],
      })),
      etl_control: {
        capture_id: etl.capture_id,
        metrics: groupMetrics(etl),
        labels: Object.values(etlLabels),
      },
    });
  }
  return outputs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(replayMisses(), null, 2)}\n`);
}
