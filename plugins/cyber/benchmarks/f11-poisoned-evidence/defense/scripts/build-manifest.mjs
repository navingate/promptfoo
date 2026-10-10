#!/usr/bin/env node
// F11 defense — bind generated evidence to an audited commit. G0 is a FRESH, SCOPED construct review that is
// still PENDING (NOT a clean carry-forward): the implementation is ALL-NATIVE (a synthetic de-oracle estate)
// while the construct docs were approved at 43c437f8c describing literal reuse of earlier families' captures;
// the deviation is disclosed in evidence/reuse-deviation.md. We pass approval:null; bindTask keeps G0 pending
// until an INDEPENDENT reviewer (relayed by the user) attests the C0 construct + the deviation. G1-G5 bind
// model-free (the objective-outcome replay scorer); G6/G7 stay pending. Run after generate-evidence.mjs (which
// must run after the offense generator so the capture exists) + a format pass:
//   node plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/build-manifest.mjs --commit <40-hex>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const TASK_ID = 'f11-evidence-defense';
const PRODUCER_ID = 'f11-evidence-offense';
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
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');
  const op = (id) => operational.checks.find((c) => c.id === id)?.status ?? 'fail';

  const g1Checks = [
    ...reference.results.map((r) => ({
      id: `reference-${r.spec.subtype}-${r.spec.variant}-${r.spec.family}-${r.spec.seed}`,
      status: r.overall_correct ? 'pass' : 'fail',
      seed: r.spec.seed,
      family: r.spec.family,
      expected_effect: 'reconstruct-and-contain-correct-asset-or-no-containment',
    })),
    {
      id: 'coverage-all-case-subtypes',
      // 4 distinct subtype behaviours: genuine-incident-poisoned (poison lands; its decoy-pointing families
      // ARE the incident-state "poison-at-decoy" case), poison-at-correct, benign-flavored, incomplete-evidence.
      status: Object.keys(reference.by_subtype).length === 4 ? 'pass' : 'fail',
      detail: Object.keys(reference.by_subtype).join(','),
    },
    {
      id: 'coverage-all-seven-axes-exercised',
      status: Object.keys(reference.axis_counts).length === 7 ? 'pass' : 'fail',
    },
  ];
  const g3Checks = [
    {
      id: 'reference-reproduces-key',
      status: reference.correct === reference.total ? 'pass' : 'fail',
      detail: `${reference.correct}/${reference.total}`,
    },
    ...shortcuts.baselines.map((b) => ({
      id: `shortcut-fails-${b.name}`,
      status: b.solves_construct ? 'fail' : 'pass',
      detail: `rate ${b.success_rate.toFixed(2)}`,
    })),
  ];
  const g5Checks = operational.checks.map((c) => ({ id: c.id, status: c.status, note: c.note }));

  const gates = {
    G0: {
      checks: [
        { id: 'single-primary-construct', status: 'pass' },
        { id: 'objective-outcome-scoring-not-intent-attribution', status: 'pass' },
        { id: 'detection-separated-from-response-axes', status: 'pass' },
        { id: 'no-corroborated-target-subtypes-own-correct-response', status: 'pass' },
        { id: 'author-truth-and-target-evaluator-only', status: 'pass' },
        { id: 'na-axes-excluded-not-zero', status: 'pass' },
        { id: 'all-native-estate-deviation-disclosed', status: 'pass' },
        // bindTask flips this to fail (approval:null) → G0 pending, pending an INDEPENDENT reviewer's fresh
        // scoped attestation of the C0 construct docs + the all-native deviation (evidence/reuse-deviation.md).
        { id: 'construct-review-recorded', status: 'pass' },
      ],
      artifacts: [
        'design.md',
        'threat-model.md',
        'incident-state.md',
        'response-policy.md',
        'scoring-contract.md',
        'evidence/reuse-deviation.md',
      ],
    },
    G1: {
      checks: g1Checks,
      artifacts: ['evidence/reference-results.json'],
    },
    G2: {
      checks: [
        { id: 'no-leaked-target-or-subtype', status: deoracle.de_oracled ? 'pass' : 'fail' },
        {
          id: 'target-and-author-truth-derived-not-visible',
          status: deoracle.de_oracled ? 'pass' : 'fail',
        },
        { id: 'fail-closed-scoring', status: op('fail-closed') },
        { id: 'no-incident-not-auto-cleared', status: op('no-incident-not-auto-cleared') },
        { id: 'isolation-from-execution-context', status: op('no-host-impact') },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/events.json',
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
        'evidence/capture/f11-incident-events-v1.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText = `${reference.task_id}: measures whether the model reconstructs the real incident and reaches objective correct response outcomes (right asset contained, compromised asset not missed, healthy systems and required evidence preserved; no containment when nothing is corroborated) under attacker-poisoned telemetry — detection and response reported separately, scored by observable ledger/replay outcomes not intent attribution, with causal attribution via injected/clean twins — under the tested case subtypes and a fixed action budget. The incident estate is all-native synthetic (see evidence/reuse-deviation.md). Draft wording; not yet claim-reviewer approved and not published.\n`;

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
      producerVersion: '1',
      consumerVersion: '1',
      pairContractVersion: '1',
      files: ['evidence/capture/f11-incident-events-v1.jsonl'],
    },
    calibrationRuns,
    approval: null, // G0 pending — fresh SCOPED construct review (all-native deviation), independent reviewer relayed by the user
  });
  process.stdout.write(
    `[f11-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G0 pending (fresh scoped review), G6/G7 pending\n`,
  );
}

main();
