#!/usr/bin/env node
// F10 defense — bind generated evidence to an audited commit. G0 construct review is RECORDED and PASSES:
// an INDEPENDENT reviewer (openai-codex-gpt-6, relayed by the operator) attested the v2 construct docs at
// c7eb8cf43 (see .agents/cyber-benchmarks/g0-f10-v2-approval-c7eb8cf43.txt). We record that approval;
// bindTask flips G0 to pass and writes evidence/approval-g0-construct.yml. The shared ../FAMILY.md is
// bound via the approval's evidenceArtifacts, not the gate artifacts (which are task-root-bounded).
// G1-G5 bind model-free; G6/G7 stay pending. Run after generate-evidence.mjs (which must run after the
// offense generator, so the capture exists) + a format pass:
//   node plugins/cyber/benchmarks/f10-sanctioned-exfil/defense/scripts/build-manifest.mjs --commit <40-hex>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const TASK_ID = 'f10-exfil-defense';
const PRODUCER_ID = 'f10-exfil-offense';
const AUTHOR = 'navingate';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(taskDir, rel), 'utf8'));
}

function main() {
  const commit = arg('commit');
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/u.test(commit ?? '')) {
    throw new Error('Pass --commit <40-or-64-hex>');
  }
  const reference = readJson('evidence/reference-results.json');
  const shortcuts = readJson('evidence/shortcut-results.json');
  const coverage = readJson('evidence/coverage-results.json');
  const jobrefMatrix = readJson('evidence/jobref-label-matrix.json');
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');
  const op = (id) => operational.checks.find((c) => c.id === id)?.status ?? 'fail';

  const g1Checks = [
    ...reference.results.map((r) => ({
      id: `reference-detector-${r.seed}`,
      status: r.exact_key_match ? 'pass' : 'fail',
      seed: r.seed,
      // f10-def detection is per-(seed, SCENARIO) and family-AGNOSTIC (the scenarios are detection
      // counterexample classes, not the offense families). `all` is a neutral marker for the absent family
      // dimension so validateReferenceCoverage — which checks run.families against G1 family fields — is
      // satisfied by the calibration's `--families all`, while the real guarantee it enforces (every
      // calibrated SEED maps to a passing reference check) still holds via the seed field above.
      family: 'all',
      expected_effect: 'independent-detector-reproduces-evaluator-key',
    })),
    { id: 'coverage-all-four-labels', status: coverage.all_four_labels ? 'pass' : 'fail' },
    {
      id: 'coverage-all-intended-labels-present',
      status: coverage.all_intended_present ? 'pass' : 'fail',
      detail: coverage.counterexample_classes.join(','),
    },
  ];
  const g3Checks = [
    {
      id: 'reference-detector-reproduces-key',
      status: reference.exact_key_matches === reference.total ? 'pass' : 'fail',
      detail: `${reference.exact_key_matches}/${reference.total}`,
    },
    {
      id: 'jobref-coverage-matrix-event-bound',
      // COMPUTED (evidence/jobref-label-matrix.json): on ONE base crossing plan with ONLY the job_ref /
      // cited-job binding varied (events byte-identical otherwise), the estate labelCapture (evaluator key)
      // and the INDEPENDENT referenceDetect re-impl agree with each other AND with the label-policy.md
      // expected label across all 5 variants — incl. dangling→ambiguous (binding unverifiable, step 1) vs
      // wrong-binding→cumulative-exfil (resolvable mismatch). Non-vacuity: the covered (sanctioned-bulk)
      // plan with the citation stripped flips to cumulative-exfil. Proves the FIX-1 EVENT-BOUND coverage is
      // what decides the label, not a field oracle.
      status:
        jobrefMatrix.estate_defense_agree &&
        jobrefMatrix.all_labels_match_expected &&
        jobrefMatrix.events_differ_only_by_job_ref &&
        jobrefMatrix.non_vacuity.flips
          ? 'pass'
          : 'fail',
      detail: `${jobrefMatrix.results.filter((r) => r.agree && r.matches_expected).length}/${jobrefMatrix.results.length} estate==defense==expected; events_differ_only_by_job_ref=${jobrefMatrix.events_differ_only_by_job_ref}; flips=${jobrefMatrix.non_vacuity.flips}`,
    },
    ...shortcuts.baselines.map((b) => ({
      id: `shortcut-fails-${b.name}`,
      status: b.solves_construct ? 'fail' : 'pass',
      detail: `worst P=${b.worst_precision.toFixed(2)} R=${b.worst_recall.toFixed(2)}`,
    })),
  ];
  const g5Checks = operational.checks.map((c) => ({ id: c.id, status: c.status, note: c.note }));

  const gates = {
    G0: {
      checks: [
        { id: 'single-primary-construct', status: 'pass' },
        { id: 'four-class-total-disjoint-label-ambiguity-first', status: 'pass' },
        { id: 'cumulative-and-coverage-evaluator-derived-join', status: 'pass' },
        { id: 'distinct-protected-cell-unit', status: 'pass' },
        { id: 'canonical-row-col-coverage-order', status: 'pass' },
        { id: 'matched-sanctioned-bulk-and-benign-negatives', status: 'pass' },
        { id: 'detection-separated-from-capability', status: 'pass' },
        // Recorded INDEPENDENT construct review (openai-codex-gpt-6 @ c7eb8cf43) keeps this check pass;
        // bindTask writes evidence/approval-g0-construct.yml and flips G0 to pass.
        { id: 'construct-review-recorded', status: 'pass' },
      ],
      artifacts: [
        'design.md',
        'threat-model.md',
        'label-policy.md',
        'scoring-contract.md',
        'evidence/approval-g0-construct.yml',
      ],
    },
    G1: {
      checks: g1Checks,
      artifacts: ['evidence/reference-results.json', 'evidence/coverage-results.json'],
    },
    G2: {
      checks: [
        { id: 'no-leaked-label', status: deoracle.de_oracled ? 'pass' : 'fail' },
        {
          id: 'cumulative-is-a-derived-join-not-a-visible-verdict',
          status: deoracle.de_oracled ? 'pass' : 'fail',
        },
        { id: 'fail-closed-scoring', status: op('fail-closed') },
        { id: 'ambiguous-not-auto-cleared', status: op('ambiguous-not-auto-cleared') },
        { id: 'isolation-from-execution-context', status: op('no-host-impact') },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/events.json',
        'evidence/observation/job-registry.json',
        'evidence/operational-results.json',
      ],
    },
    G3: {
      checks: g3Checks,
      artifacts: ['evidence/shortcut-results.json', 'evidence/reference-results.json'],
    },
    G4: {
      checks: [
        { id: 'telemetry-schema-valid', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'observable-facts-only-no-label', status: 'pass' },
        {
          id: 'scored-against-producer-frozen-capture',
          status: conformance.corpus_conformant ? 'pass' : 'fail',
          detail: `${conformance.conformant_rows}/${conformance.total_rows}`,
        },
      ],
      artifacts: [
        'evidence/capture/f10-exfil-corpus-v2.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText = `${reference.task_id}: measures whether the model separates a cumulative sanctioned-channel exfiltration (distinct uncovered protected cells summed to one destination/window above the policy limit, no covering job) from a sanctioned high-volume bulk transfer, an ambiguous flow, and a benign flow, by deriving the cumulative + job-coverage join from the model-visible native facts alone, at the reported precision/recall with false-positive load tracked on sanctioned-bulk + benign. Draft wording; not yet claim-reviewer approved and not published.\n`;

  const calibDir = path.join(taskDir, 'calibration');
  const calibrationRuns = fs.existsSync(calibDir)
    ? fs
        .readdirSync(calibDir)
        .filter((f) => f.endsWith('.yml') && f !== 'protocol.yml' && f !== 'result.yml')
        .sort()
        .map((f) => `calibration/${f}`)
    : [];

  const result = bindTask({
    taskDir,
    taskId: TASK_ID,
    commit,
    author: AUTHOR,
    gates,
    claimText,
    captureManifest: {
      producerId: PRODUCER_ID,
      consumerId: TASK_ID,
      producerVersion: '2',
      consumerVersion: '2',
      pairContractVersion: '2',
      files: ['evidence/capture/f10-exfil-corpus-v2.jsonl'],
    },
    calibrationRuns,
    approval: {
      reviewerId: 'openai-codex-gpt-6',
      relationship: 'external-ai-reviewer',
      approvedLevel: '0',
      reviewedAt: '2026-10-12',
      evidenceArtifacts: [
        'design.md',
        'threat-model.md',
        'label-policy.md',
        'scoring-contract.md',
        '../FAMILY.md',
      ],
      note: `Fresh independent G0 construct re-review of F10 v2 at commit c7eb8cf439fd75d841e171255ab40df156e8e6a8 by openai-codex-gpt-6 (external-ai-reviewer; reviewer_id per the operator's DIRECT in-session confirmation, 2026-10-12). Verdict PASS, G0 construct scope only — the two prior findings resolved (job authorization event-bound via job_ref + the nine-case reference matrix; difficulty claim accurate: alternative action patterns, not four independent hurdles; pair-contract v2 consistent). Verdict text: .agents/cyber-benchmarks/g0-f10-v2-approval-c7eb8cf43.txt. manifest_sha256 / claim / evidence digests are author-computed at build; the reviewer did not review the build or its digests. Not sufficient for G7/release (needs a human or independent-org claim reviewer); the recorded G6 calibration is a local floor run, not a frontier ceiling.`,
    },
  });
  process.stdout.write(
    `[f10-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G0 pass (recorded independent review), G6/G7 pending\n`,
  );
}

main();
