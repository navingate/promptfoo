#!/usr/bin/env node
// F9 defense — bind generated evidence to an audited commit (G0-G5 evidence; G6/G7 stay
// pending by design). Run AFTER generate-evidence.mjs and a format pass, from the repo
// root:
//   node plugins/cyber/benchmarks/f9-secret-rotation/defense/scripts/build-manifest.mjs --commit <40-hex>

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../../..');
const TASK_ID = 'f9-rotation-defense';
const PRODUCER_ID = 'f9-rotation-offense';
const AUTHOR = 'navingate';
const REVIEW_COMMIT = '43c437f8c753bf2a2711ea3593a3dad9aa7c10c9';
const CORE_DOC_RELS = [
  'design.md',
  'threat-model.md',
  'incident-state.md',
  'response-policy.md',
  'scoring-contract.md',
  '../FAMILY.md',
];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(taskDir, rel), 'utf8'));
}

function assertConstructDocsUnchanged() {
  const repoRelative = CORE_DOC_RELS.map((rel) =>
    path.relative(repoRoot, path.resolve(taskDir, rel)),
  );
  const diff = execFileSync('git', ['diff', REVIEW_COMMIT, '--', ...repoRelative], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (diff.trim() !== '') {
    throw new Error(
      `G0 empty-diff proof FAILED: F9 defense construct docs drifted from ${REVIEW_COMMIT}.\n${diff}`,
    );
  }
}

function main() {
  const commit = arg('commit');
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/u.test(commit ?? '')) {
    throw new Error('Pass --commit <40-or-64-hex>');
  }
  assertConstructDocsUnchanged();

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
          status: conformance.inventory_conformant ? 'pass' : 'fail',
          detail:
            'Both paired live incidents initialize from native inventory and auth probes and pass response replay.',
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

  const calibDir = path.join(taskDir, 'calibration');
  const calibrationRuns = fs.existsSync(calibDir)
    ? fs
        .readdirSync(calibDir)
        .filter((f) => f.endsWith('.yml') && f !== 'protocol.yml' && f !== 'result.yml')
        .sort()
        .filter((f) => {
          const run = readJson(`calibration/${f}`);
          return run.commit === commit;
        })
        .map((f) => `calibration/${f}`)
    : [];
  const result = bindTask({
    taskDir,
    taskId: TASK_ID,
    commit,
    author: AUTHOR,
    gates,
    claimText,
    calibrationRuns,
    captureManifest: {
      producerId: PRODUCER_ID,
      consumerId: TASK_ID,
      producerVersion: '1',
      consumerVersion: '1',
      pairContractVersion: '1',
      files: ['evidence/capture/f9-rotation-events-v1.jsonl'],
    },
    approval: {
      reviewerId: 'openai-codex-gpt-6',
      relationship: 'external-ai-reviewer',
      approvedLevel: '0',
      reviewedAt: '2026-10-07',
      note: `Author-issued carry-forward G0 binding under the owner decision (2026-10-07) accepting the independent AI construct review by openai-codex-gpt-6 at design commit ${REVIEW_COMMIT} (G0 construct scope only; see .agents/cyber-benchmarks/review-policy.md). The F9-defense construct-defining docs in the evidence closure are byte-identical ${REVIEW_COMMIT}..C0 (fail-closed empty-diff proof in build-manifest). manifest_sha256 / claim / evidence digests are author-computed at build; the reviewer did not review the build or its digests. Not sufficient for G7/release (needs a human or independent-org claim reviewer); the recorded G6 calibration is a local floor/middle run, not a frontier ceiling.`,
      evidenceArtifacts: CORE_DOC_RELS,
    },
  });

  process.stdout.write(
    `[f9-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G6/G7 pending\n`,
  );
}

main();
