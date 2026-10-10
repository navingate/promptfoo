// Shared writer for G6 calibration evidence. Given a completed run's tally + raw
// material, it writes the run record, its four SHA-bound artifacts (config, prompt,
// raw_output, summarized_output), the protocol, and the result into <taskDir>/calibration/,
// shaped to exactly what audit_benchmark.mjs `validateCalibration` requires. The caller
// (the runner) produces the tally; this module only formats, hashes, and reconciles.
//
// Several runs (one model each — e.g. a local floor run plus hosted runs) share one protocol
// and one result: after writing a run, the protocol + result are rebuilt over EVERY run record
// bound to the same commit, in the binder's discovery order (sorted file name).
//
// G6 honesty: the recorder never flips the G6 gate — `limitations[0]` says so.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Dependency-free IO. This module runs from a bare `git archive` on the eval VM, which has
// NO node_modules — so it must not import evidence-lib.mjs (that pulls in js-yaml). JSON is a
// strict subset of YAML, so JSON content written to a .yml file parses correctly in the
// authoring auditor (loadMapping parses it as YAML).
function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}
function writeText(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function writeJson(abs, obj) {
  writeText(abs, `${JSON.stringify(obj, null, 2)}\n`);
}
function writeYaml(abs, obj) {
  writeText(abs, `${JSON.stringify(obj, null, 2)}\n`);
}

function artifactRef(taskDir, rel) {
  return { path: rel, sha256: sha256File(path.join(taskDir, rel)) };
}

// Same interval as the runner's, so per-run numbers match what it prints.
function wilson95(pass, n) {
  if (n === 0) {
    return { low: 0, high: 0 };
  }
  const p = pass / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return {
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

function modelLabel(run) {
  return run.model?.attacker_sut?.id ?? run.model?.id ?? 'unknown-model';
}

// Every run record bound to this commit, in the order the binders wire them (sorted file name).
// Records bound to another commit are skipped exactly as the binders skip them.
function loadRuns(taskDir, taskId, commit) {
  const dir = path.join(taskDir, 'calibration');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') && f !== 'protocol.yml' && f !== 'result.yml')
    .sort();
  const runs = [];
  const skipped = [];
  for (const file of files) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (run.commit !== commit) {
      skipped.push(`calibration/${file}`);
      continue;
    }
    if (run.task_id !== taskId) {
      throw new Error(`calibration/${file} belongs to task ${run.task_id}, not ${taskId}`);
    }
    const config = JSON.parse(
      fs.readFileSync(path.join(taskDir, run.artifacts.config.path), 'utf8'),
    );
    runs.push({
      rel: `calibration/${file}`,
      run,
      tier: config.tier ?? 'local',
      runLimitations: config.run_limitations ?? [
        `${run.run_id} (${modelLabel(run)}): local floor/middle probe; single samples, directional only.`,
      ],
    });
  }
  return { runs, skipped };
}

/**
 * Write all calibration evidence for one run, then rebuild the shared protocol + result over
 * every run bound to the same commit. Returns the manifest-relative paths the binder wires into
 * manifest.calibration, plus any stale-commit records that were left out.
 *
 * input = {
 *   taskDir, taskId, commit, runId, model, harness, opportunityBudget,
 *   seeds:[>=2 distinct], families:[>=1], instanceIds:[distinct],
 *   tally: { completed, pass, fail, model_failures, provider_errors, invalid_runs, stage_survival },
 *   declaredMinimum: { instances, attempts },
 *   rawLines: [string], summaryLines: [object], samplePrompt: string, runConfig: object,
 *   protocolMeta: object, tier: 'local' | 'hosted', limitations: [string] (this run's own),
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
    tier = 'local',
    limitations,
  } = input;

  const dir = path.join(taskDir, 'calibration');
  const rel = (name) => `calibration/${name}`;

  // --- Four artifacts (verified by SHA in the run record) ---
  // The config also carries this run's tier + limitations so later rebuilds can restate them.
  const configRel = rel(`${runId}-config.json`);
  const promptRel = rel(`${runId}-prompt.txt`);
  const rawRel = rel(`${runId}-raw.jsonl`);
  const summaryRel = rel(`${runId}-summary.jsonl`);
  writeJson(path.join(dir, `${runId}-config.json`), {
    ...runConfig,
    tier,
    run_limitations: limitations,
  });
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

  // --- Protocol + result, rebuilt over every run bound to this commit ---
  const { runs, skipped } = loadRuns(taskDir, taskId, commit);
  const label = (entry) => modelLabel(entry.run);
  const allSeeds = [...new Set(runs.flatMap((entry) => entry.run.seeds))];
  const allFamilies = [...new Set(runs.flatMap((entry) => entry.run.families))];
  const instances = new Set(runs.flatMap((entry) => entry.run.instance_ids));
  const sum = (pick) => runs.reduce((total, entry) => total + pick(entry.run), 0);

  const protocol = {
    schema_version: 1,
    task_id: taskId,
    commit,
    runs: runs.map((entry) => ({
      run_id: entry.run.run_id,
      tier: entry.tier,
      model: entry.run.model,
    })),
    harness,
    opportunity_budget: opportunityBudget,
    seeds: allSeeds,
    families: allFamilies,
    ...protocolMeta,
    sample_size_rationale: `${runs.length} run(s), one model each, over ${instances.size} instances across ${allFamilies.length} families and ${allSeeds.length} seeds; a probe, not a powered estimate.`,
  };
  const protocolRel = rel('protocol.yml');
  writeYaml(path.join(taskDir, protocolRel), protocol);

  const hosted = runs.filter((entry) => entry.tier !== 'local');
  const unmatched = runs.filter(
    (entry) => JSON.stringify(entry.run.opportunity_budget) !== JSON.stringify(opportunityBudget),
  );
  const resultLimitations = [
    hosted.length === 0
      ? 'No frontier ceiling run — this is the local model only (floor/middle); the G6 gate is kept PENDING.'
      : `Hosted run(s) recorded (${hosted.map(label).join(', ')}); the recorder never flips G6 — the gate is kept PENDING until a reviewed ceiling decision.`,
    runs.length === 1
      ? `Single model (${label(runs[0])}); not a cross-model calibration.`
      : `Cross-model: ${runs.map((entry) => `${entry.run.run_id} = ${label(entry)} [${entry.tier}]`).join('; ')}. Pass rates are per run, never pooled.`,
    ...(unmatched.length > 0
      ? [
          `Opportunity budget differs from the latest run's for ${unmatched.map((entry) => entry.run.run_id).join(', ')}; those comparisons are not matched.`,
        ]
      : []),
    ...new Set(runs.flatMap((entry) => entry.runLimitations)),
  ];
  const declaredAttempts = sum((run) => run.attempts.declared_minimum);
  const validAttempts = sum((run) => run.attempts.completed);
  const result = {
    schema_version: 1,
    task_id: taskId,
    commit,
    protocol: artifactRef(taskDir, protocolRel),
    runs: runs.map((entry) => artifactRef(taskDir, entry.rel)),
    declared_minimum: { instances: declaredMinimum.instances, attempts: declaredAttempts },
    completed: { instances: instances.size, valid_attempts: validAttempts },
    outcome_counts: {
      pass: sum((run) => run.outcomes.pass),
      fail: sum((run) => run.outcomes.fail),
      provider_errors: sum((run) => run.attempts.provider_errors),
      invalid_runs: sum((run) => run.attempts.invalid_runs),
    },
    uncertainty: {
      method: 'Wilson score 95% interval on the pass rate, per run (one model per run; not pooled)',
      result: runs
        .map(({ run }) => {
          const n = run.attempts.completed;
          const ci = wilson95(run.outcomes.pass, n);
          const rate = n === 0 ? 0 : run.outcomes.pass / n;
          return `${run.run_id} (${modelLabel(run)}): pass_rate=${rate.toFixed(4)} (pass ${run.outcomes.pass}/${n}); 95% CI [${ci.low.toFixed(4)}, ${ci.high.toFixed(4)}]`;
        })
        .join('; '),
    },
    limitations: resultLimitations,
    minima_met: instances.size >= declaredMinimum.instances && validAttempts >= declaredAttempts,
  };
  const resultRel = rel('result.yml');
  writeYaml(path.join(taskDir, resultRel), result);

  return {
    runPath: runRel,
    protocolPath: protocolRel,
    resultPath: resultRel,
    runPaths: runs.map((entry) => entry.rel),
    skipped,
  };
}
