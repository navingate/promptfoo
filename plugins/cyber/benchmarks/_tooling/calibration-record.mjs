// Shared writer for G6 calibration evidence. Given a completed run's tally + raw
// material, it writes the run record, its four SHA-bound artifacts (config, prompt,
// raw_output, summarized_output), the protocol, and the result into <taskDir>/calibration/,
// shaped to exactly what audit_benchmark.mjs `validateCalibration` requires. The caller
// (the runner) produces the tally; this module only formats, hashes, and reconciles.
//
// G6 honesty: this records the LOCAL floor/middle run. The G6 gate stays pending until a
// frontier ceiling run — `limitations[0]` must say so and the result is kept, never flipped.

import path from 'node:path';

import { sha256File, writeJson, writeText, writeYaml } from './evidence-lib.mjs';

function artifactRef(taskDir, rel) {
  return { path: rel, sha256: sha256File(path.join(taskDir, rel)) };
}

/**
 * Write all calibration evidence for one run. Returns the manifest-relative paths the
 * binder wires into manifest.calibration.
 *
 * input = {
 *   taskDir, taskId, commit, runId, model, harness, opportunityBudget,
 *   seeds:[>=2 distinct], families:[>=1], instanceIds:[distinct],
 *   tally: { completed, pass, fail, model_failures, provider_errors, invalid_runs, stage_survival },
 *   declaredMinimum: { instances, attempts },
 *   rawLines: [string], summaryLines: [object], samplePrompt: string, runConfig: object,
 *   protocolMeta: object, uncertainty: {method,result}, limitations: [string >=1],
 * }
 */
export function writeCalibrationEvidence(input) {
  const {
    taskDir,
    taskId,
    commit,
    runId,
    model,
    harness,
    opportunityBudget,
    seeds,
    families,
    instanceIds,
    tally,
    declaredMinimum,
    rawLines,
    summaryLines,
    samplePrompt,
    runConfig,
    protocolMeta,
    uncertainty,
    limitations,
  } = input;

  const dir = path.join(taskDir, 'calibration');
  const rel = (name) => `calibration/${name}`;

  // --- Four artifacts (verified by SHA in the run record) ---
  const configRel = rel(`${runId}-config.json`);
  const promptRel = rel(`${runId}-prompt.txt`);
  const rawRel = rel(`${runId}-raw.jsonl`);
  const summaryRel = rel(`${runId}-summary.jsonl`);
  writeJson(path.join(dir, `${runId}-config.json`), runConfig);
  writeText(path.join(dir, `${runId}-prompt.txt`), `${samplePrompt}\n`);
  writeText(path.join(dir, `${runId}-raw.jsonl`), `${rawLines.join('\n')}\n`);
  writeText(
    path.join(dir, `${runId}-summary.jsonl`),
    `${summaryLines.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );

  // --- Run record ---
  const runRecord = {
    schema_version: 1,
    task_id: taskId,
    commit,
    run_id: runId,
    model,
    harness,
    opportunity_budget: opportunityBudget,
    seeds,
    families,
    instance_ids: instanceIds,
    attempts: {
      declared_minimum: declaredMinimum.attempts,
      completed: tally.completed,
      model_failures: tally.model_failures,
      provider_errors: tally.provider_errors,
      invalid_runs: tally.invalid_runs,
    },
    outcomes: { pass: tally.pass, fail: tally.fail },
    stage_survival: tally.stage_survival,
    artifacts: {
      config: artifactRef(taskDir, configRel),
      prompt: artifactRef(taskDir, promptRel),
      raw_output: artifactRef(taskDir, rawRel),
      summarized_output: artifactRef(taskDir, summaryRel),
    },
  };
  const runRel = rel(`${runId}.yml`);
  writeYaml(path.join(taskDir, runRel), runRecord);

  // --- Protocol ---
  const protocol = {
    schema_version: 1,
    task_id: taskId,
    commit,
    model,
    harness,
    opportunity_budget: opportunityBudget,
    seeds,
    families,
    ...protocolMeta,
  };
  const protocolRel = rel('protocol.yml');
  writeYaml(path.join(taskDir, protocolRel), protocol);

  // --- Result (reconciles over the single run) ---
  const result = {
    schema_version: 1,
    task_id: taskId,
    commit,
    protocol: artifactRef(taskDir, protocolRel),
    runs: [artifactRef(taskDir, runRel)],
    declared_minimum: { instances: declaredMinimum.instances, attempts: declaredMinimum.attempts },
    completed: { instances: instanceIds.length, valid_attempts: tally.completed },
    outcome_counts: {
      pass: tally.pass,
      fail: tally.fail,
      provider_errors: tally.provider_errors,
      invalid_runs: tally.invalid_runs,
    },
    uncertainty,
    limitations,
    minima_met:
      instanceIds.length >= declaredMinimum.instances &&
      tally.completed >= declaredMinimum.attempts,
  };
  const resultRel = rel('result.yml');
  writeYaml(path.join(taskDir, resultRel), result);

  return { runPath: runRel, protocolPath: protocolRel, resultPath: resultRel };
}
