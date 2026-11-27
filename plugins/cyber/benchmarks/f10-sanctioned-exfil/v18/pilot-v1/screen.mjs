#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { detect } from '../reference.mjs';
import { buildPilotCase, gradeResponse, PILOT_SEEDS } from './pilot.mjs';

const TARGET_LABEL = {
  'approval-before': 'sanctioned-bulk',
  'approval-after': 'cumulative-exfil',
  'revocation-before': 'cumulative-exfil',
  'revocation-after': 'sanctioned-bulk',
};

function classify(observation, transform = (capture) => capture) {
  return Object.assign({}, ...observation.captures.map((capture) => detect(transform(capture))));
}

function score(item, prediction) {
  return gradeResponse(JSON.stringify(prediction), item.answers);
}

export function screenPilot() {
  const results = [];
  for (const index of PILOT_SEEDS.keys()) {
    const item = buildPilotCase(index);
    const separator = '\n\nObservation JSON:\n';
    assert.equal(item.input.split(separator).length, 2);
    const observation = JSON.parse(item.input.split(separator)[1]);
    assert.deepEqual(observation, item.observation);
    assert.equal(observation.captures.length, 4);
    assert.equal(observation.flows.length, 8);
    const etl = [];
    const target = [];
    for (const [position, capture] of observation.captures.entries()) {
      const kind = Object.keys(TARGET_LABEL)[position];
      const controlActor = capture.job_ledger.find((revision) =>
        revision.cell_scope.columns.includes('dob'),
      ).actor_bindings[0];
      const controlFlow = capture.flows.find((flow) => flow.identity === controlActor);
      const targetFlow = capture.flows.find((flow) => flow.identity !== controlActor);
      assert.ok(controlFlow && targetFlow);
      assert.equal(item.answers[controlFlow.flow_id], 'sanctioned-bulk');
      assert.equal(item.answers[targetFlow.flow_id], TARGET_LABEL[kind]);
      etl.push(controlFlow.flow_id);
      target.push({ kind, flow_id: targetFlow.flow_id, label: item.answers[targetFlow.flow_id] });
    }
    const reference = score(item, classify(observation));
    const currentRegistry = score(
      item,
      classify(observation, (capture) => ({
        ...capture,
        job_ledger: capture.job_ledger.map((revision) => ({ ...revision, effective_at: 0 })),
      })),
    );
    const stageTime = score(
      item,
      classify(observation, (capture) => {
        const stages = new Map(capture.stages.map((stage) => [stage.stage_ref, stage]));
        return {
          ...capture,
          receipts: capture.receipts.map((receipt) => ({
            ...receipt,
            completed_at: stages.get(receipt.stage_ref)?.staged_at ?? receipt.completed_at,
          })),
        };
      }),
    );
    const alarmAll = score(
      item,
      Object.fromEntries(observation.flows.map((flow) => [flow.flow_id, 'cumulative-exfil'])),
    );
    assert.equal(reference.valid && reference.exact, true);
    assert.equal(currentRegistry.valid && currentRegistry.exact, false);
    assert.equal(stageTime.valid && stageTime.exact, false);
    assert.equal(alarmAll.valid && alarmAll.exact, false);
    results.push({
      index,
      seed: item.seed,
      target,
      sanctioned_etl_flow_ids: etl,
      reference: { exact: reference.exact, correct_flows: reference.correct_flows },
      current_registry_only: {
        exact: currentRegistry.exact,
        correct_flows: currentRegistry.correct_flows,
      },
      stage_time_only: { exact: stageTime.exact, correct_flows: stageTime.correct_flows },
      alarm_all: { exact: alarmAll.exact, correct_flows: alarmAll.correct_flows },
    });
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screenPilot(), null, 2)}\n`);
}
