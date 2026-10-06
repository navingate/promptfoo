#!/usr/bin/env node
// F9 defense — bind generated evidence to an audited commit (G0-G5 evidence; G6/G7 stay
// pending by design). Run AFTER generate-evidence.mjs and a format pass, from the repo
// root:
//   node plugins/cyber/benchmarks/f9-secret-rotation/defense/scripts/build-manifest.mjs --commit <40-hex>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const TASK_ID = 'f9-rotation-defense';
const PRODUCER_ID = 'f9-rotation-offense';
const AUTHOR = 'navingate';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
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
  const mutations = readJson('evidence/mutation-results.json');
  const shortcuts = readJson('evidence/shortcut-results.json');
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');

  const g1Checks = [
    ...reference.results.map((r) => ({
      id: `reference-${r.subtype}-${r.family}-${r.seed}`,
      status: r.overall_correct ? 'pass' : 'fail',
      seed: r.seed,
      family: r.family,
      subtype: r.subtype,
      expected_effect: 'subtype-correct-response',
    })),
    ...mutations.checks.map((c) => ({ id: c.id, status: c.status, family: c.family })),
  ];

  const g3Checks = [
    {
      id: 'reference-correct-all-subtypes',
      status: reference.correct === reference.total ? 'pass' : 'fail',
      detail: `${reference.correct}/${reference.total}`,
    },
    ...shortcuts.baselines.map((b) => ({
      id: `shortcut-fails-${b.name}`,
      status: b.solves_construct ? 'fail' : 'pass',
      detail: `correct_rate=${b.correct_rate}`,
    })),
  ];

  const g5Checks = operational.checks.map((c) => ({ id: c.id, status: c.status, note: c.note }));

  const gates = {
    G0: {
      checks: [
        { id: 'single-primary-construct', status: 'pass' },
        { id: 'deterministic-decision-boundary', status: 'pass' },
        { id: 'response-matrix-per-subtype', status: 'pass' },
        { id: 'matched-benign-and-ambiguous', status: 'pass' },
        { id: 'detection-response-separated-from-offense', status: 'pass' },
        { id: 'construct-review-recorded', status: 'pass' },
      ],
      artifacts: [
        'design.md',
        'threat-model.md',
        'incident-state.md',
        'response-policy.md',
        'scoring-contract.md',
        'evidence/approval-g0-construct.yml',
      ],
    },
    G1: {
      checks: g1Checks,
      artifacts: ['evidence/reference-results.json', 'evidence/mutation-results.json'],
    },
    G2: {
      checks: [
        { id: 'no-leaked-subtype-label', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'no-final-status-oracle', status: deoracle.de_oracled ? 'pass' : 'fail' },
        {
          id: 'fail-closed-scoring',
          status: operational.checks.find((c) => c.id === 'fail-closed')?.status ?? 'fail',
        },
        {
          id: 'isolation-from-execution-context',
          status: operational.checks.find((c) => c.id === 'no-host-impact')?.status ?? 'fail',
        },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/incident-evidence.json',
        'evidence/observation/events.jsonl',
        'evidence/operational-results.json',
      ],
    },
    G3: {
      checks: g3Checks,
      artifacts: ['evidence/shortcut-results.json', 'evidence/mutation-results.json'],
    },
    G4: {
      checks: [
        { id: 'telemetry-schema-valid', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'no-synthesized-security-facts', status: 'pass' },
        {
          id: 'capture-inventory-reconstructed',
          status: conformance.inventory_conformant ? 'pass' : 'fail',
          detail: `producer=${conformance.producer_task_id}`,
        },
        {
          id: 'live-snapshot-initialized-from-capture',
          status: 'fail',
          detail:
            'The live incident still regenerates state from seed instead of the frozen native capture.',
        },
      ],
      artifacts: [
        'evidence/capture/f9-rotation-events-v1.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText =
    'Measures safe-order secret rotation and recovery under active compromise — investigation, triage ' +
    'against a per-subtype response matrix, rotation ordering, proven revocation, and service ' +
    'preservation — scored by replay under the tested cases. Draft wording; not yet claim-reviewer ' +
    'approved and not published.\n';

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
      files: ['evidence/capture/f9-rotation-events-v1.jsonl'],
    },
    approval: null,
  });

  process.stdout.write(
    `[f9-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G6/G7 pending\n`,
  );
}

main();
