#!/usr/bin/env node
// F10 defense — bind generated evidence to an audited commit. G0 is a FRESH construct review that is
// still PENDING: the v2 construct (per-destination aggregate key, 4-class total/disjoint label with the
// residual benign class, distinct-cell canonical coverage) changed after 43c437f8c and cannot be carried
// forward; F2 Chain authored the change and cannot review it. We pass approval:null; bindTask keeps G0
// pending until an INDEPENDENT reviewer (relayed by the user) attests the C0 construct docs. G1-G5 bind
// model-free; G6/G7 stay pending. Run after generate-evidence.mjs (which must run after the offense
// generator, so the capture exists) + a format pass:
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
        // bindTask flips this to fail (approval:null) → G0 pending, pending an INDEPENDENT reviewer's
        // attestation of the C0 construct docs (fresh v2 review; see F10-V2-REVIEW-REQUEST.md).
        { id: 'construct-review-recorded', status: 'pass' },
      ],
      artifacts: ['design.md', 'threat-model.md', 'label-policy.md', 'scoring-contract.md'],
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
    approval: null, // G0 pending — fresh v2 construct review, independent reviewer relayed by the user
  });
  process.stdout.write(
    `[f10-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G0 pending (fresh independent review), G6/G7 pending\n`,
  );
}

main();
