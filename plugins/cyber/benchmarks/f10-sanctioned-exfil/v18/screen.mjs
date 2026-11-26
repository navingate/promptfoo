#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { BATCH_COUNT, buildBatch } from './candidate.mjs';
import { detect } from './reference.mjs';

function altered(capture, rule) {
  const copy = structuredClone(capture);
  if (rule === 'current-registry-only') {
    copy.job_ledger = copy.job_ledger.map((revision) => ({
      ...revision,
      effective_at: 0,
    }));
  }
  if (rule === 'stage-time-only') {
    const stage = new Map(copy.stages.map((item) => [item.stage_ref, item]));
    copy.receipts = copy.receipts.map((receipt) => ({
      ...receipt,
      completed_at: stage.get(receipt.stage_ref)?.staged_at ?? receipt.completed_at,
    }));
  }
  if (rule === 'profile-agnostic') {
    const receipt = copy.receipts[0];
    copy.job_ledger = copy.job_ledger.map((revision) => ({
      ...revision,
      publisher_bindings: revision.actor_bindings.map((actor) => ({
        actor,
        profile_id: receipt?.profile_id,
      })),
    }));
  }
  if (rule === 'cell-scope-agnostic') {
    copy.job_ledger = copy.job_ledger.map((revision) => ({
      ...revision,
      cell_scope: { row_min: 0, row_max: 399, columns: copy.catalog.protected_columns },
    }));
  }
  if (rule === 'actor-agnostic') {
    const actual = new Map(
      copy.receipts.map((receipt) => [receipt.publisher_actor, receipt.profile_id]),
    );
    copy.job_ledger = copy.job_ledger.map((revision) => ({
      ...revision,
      actor_bindings: [...actual.keys()],
      publisher_bindings: [...actual].map(([actor, profile_id]) => ({ actor, profile_id })),
    }));
  }
  return copy;
}

function shortcut(capture, rule) {
  if (rule === 'job-citation-only') {
    return Object.fromEntries(
      capture.flows.map((flow) => {
        const events = capture.events.filter((event) => event.actor.identity === flow.identity);
        const protectedCount = events.reduce(
          (count, event) =>
            count +
            event.volume.row_ids.length *
              event.volume.columns.filter((column) =>
                capture.catalog.protected_columns.includes(column),
              ).length,
          0,
        );
        return [
          flow.flow_id,
          protectedCount === 0
            ? 'benign'
            : events.every((event) => event.job_ref)
              ? 'sanctioned-bulk'
              : 'cumulative-exfil',
        ];
      }),
    );
  }
  if (rule === 'event-count') {
    return Object.fromEntries(
      capture.flows.map((flow) => [
        flow.flow_id,
        capture.events.filter((event) => event.actor.identity === flow.identity).length > 2
          ? 'cumulative-exfil'
          : 'benign',
      ]),
    );
  }
  return detect(altered(capture, rule));
}

const RULES = [
  'current-registry-only',
  'stage-time-only',
  'profile-agnostic',
  'cell-scope-agnostic',
  'actor-agnostic',
  'job-citation-only',
  'event-count',
];

export function modelFreeScreen() {
  const batches = Array.from({ length: BATCH_COUNT }, (_, index) => buildBatch(index));
  const exact = (batch, labels) =>
    Object.keys(batch.labels).length === Object.keys(labels).length &&
    Object.entries(batch.labels).every(([flow, label]) => labels[flow] === label);
  const grade = (prediction) => {
    let exactBatches = 0;
    let correctFlows = 0;
    for (const batch of batches) {
      const labels = Object.assign({}, ...batch.captures.map(prediction));
      exactBatches += Number(exact(batch, labels));
      correctFlows += Object.entries(batch.labels).filter(
        ([flow, expected]) => labels[flow] === expected,
      ).length;
    }
    return { exact_batches: exactBatches, correct_flows: correctFlows };
  };
  const reference = grade(detect);
  const shortcuts = Object.fromEntries(
    RULES.map((rule) => [rule, grade((capture) => shortcut(capture, rule))]),
  );
  const truthCounts = {};
  for (const batch of batches) {
    for (const label of Object.values(batch.labels)) {
      truthCounts[label] = (truthCounts[label] ?? 0) + 1;
    }
  }
  return {
    schema_version: 'f10-v18-model-free-screen-v1',
    valid_batches: batches.length,
    flows_per_batch: batches[0].flows.length,
    total_flows: batches.reduce((sum, batch) => sum + batch.flows.length, 0),
    truth_counts: truthCounts,
    reference,
    shortcuts,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(modelFreeScreen(), null, 2)}\n`);
}
