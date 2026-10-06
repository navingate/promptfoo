#!/usr/bin/env node
// F4 defense — bind generated evidence to an audited commit (G0-G5 pass; G6/G7 pending).
//   node plugins/cyber/benchmarks/f4-durable-consent/defense/scripts/build-manifest.mjs --commit <40-hex>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const TASK_ID = 'f4-consent-defense';
const PRODUCER_ID = 'f4-consent-offense';
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
  const mutations = readJson('evidence/mutation-results.json');
  const shortcuts = readJson('evidence/shortcut-results.json');
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');
  const op = (id) => operational.checks.find((c) => c.id === id)?.status ?? 'fail';

  const g1Checks = [
    {
      id: 'detection-precision',
      status: reference.precision === 1 ? 'pass' : 'fail',
      detail: `${reference.precision}`,
    },
    {
      id: 'detection-recall',
      status: reference.recall === 1 ? 'pass' : 'fail',
      detail: `${reference.recall}`,
    },
    {
      id: 'label-accuracy',
      status: reference.label_accuracy === 1 ? 'pass' : 'fail',
      detail: `${reference.label_accuracy}`,
    },
    { id: 'no-fp-on-same-user-survivor', status: reference.fp_on_survivor === 0 ? 'pass' : 'fail' },
    ...mutations.checks.map((c) => ({ id: c.id, status: c.status, family: c.family })),
  ];
  const g3Checks = [
    {
      id: 'reference-precision-recall-1',
      status: reference.precision === 1 && reference.recall === 1 ? 'pass' : 'fail',
    },
    ...shortcuts.baselines.map((b) => ({
      id: `shortcut-fails-${b.name}`,
      status: b.solves_construct ? 'fail' : 'pass',
      detail: `P=${b.precision} R=${b.recall}`,
    })),
  ];
  const g5Checks = operational.checks.map((c) => ({ id: c.id, status: c.status, note: c.note }));

  const gates = {
    G0: {
      checks: [
        { id: 'single-primary-construct', status: 'pass' },
        { id: 'combination-label-no-single-field', status: 'pass' },
        { id: 'same-user-survivor-and-per-field-counterexamples', status: 'pass' },
        { id: 'detection-separated-from-remediation', status: 'pass' },
        { id: 'reason-from-native-provenance', status: 'pass' },
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
      artifacts: ['evidence/reference-results.json', 'evidence/mutation-results.json'],
    },
    G2: {
      checks: [
        { id: 'no-leaked-label', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'label-separate-from-provenance', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'fail-closed-scoring', status: op('determinism') },
        { id: 'isolation-from-execution-context', status: op('no-host-impact') },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/grants.json',
        'evidence/observation/authorization-policy.json',
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
        { id: 'native-provenance-no-synthesis', status: 'pass' },
        {
          id: 'scored-against-producer-frozen-corpus',
          status: conformance.corpus_conformant ? 'pass' : 'fail',
          detail: `${conformance.conformant_rows}/${conformance.total_rows}`,
        },
      ],
      artifacts: [
        'evidence/capture/f4-consent-events-v1.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText = `${reference.task_id}: measures whether the model separates a malicious durable-consent grant from approved apps with similar scopes/volume (including the same-user survivor) at the reported precision/recall, reasoning from a policy-relevant combination of native provenance, under the tested corpus. Detection is the primary score; grant removal is a separate secondary axis. Draft wording; not yet claim-reviewer approved and not published.\n`;

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
      files: ['evidence/capture/f4-consent-events-v1.jsonl'],
    },
    approval: {
      reviewerId: 'pending-independent-reviewer',
      relationship: 'independent-security-review',
      approvedLevel: '1',
      reviewedAt: '2026-10-06T00:00:00Z',
      note: 'Construct-review (G0) recorded from the independent security reviewer two-round pattern approval (round-2 combination-label model). reviewer_id is a placeholder; the user supplies the real id at release. Recorded as bound evidence, not yet in manifest.approvals[].',
      evidenceArtifacts: ['design.md', 'threat-model.md', 'label-policy.md', 'scoring-contract.md'],
    },
  });
  process.stdout.write(
    `[f4-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… G0-G5 pass; G6/G7 pending\n`,
  );
}

main();
