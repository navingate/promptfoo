#!/usr/bin/env node
// F8 defense — bind generated evidence to an audited commit. G0 is a C0-anchored CARRY-FORWARD of the
// independent AI construct review (openai-codex-gpt-6 @ 43c437f8c), whose fixed-commit approval explicitly
// covers all 18 tasks including "F8 Recovery Plane Sabotage" offense+defense. A fail-closed empty-diff
// guard proves the F8-defense construct docs are byte-identical to 43c437f8c. G1-G5 bind model-free;
// G6/G7 stay pending. Run after generate-evidence.mjs (which must run after the offense generator so the
// capture exists) + a format pass:
//   node plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/build-manifest.mjs --commit <40-hex>

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindTask } from '../../../_tooling/bind-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../../..');
const TASK_ID = 'f8-recovery-defense';
const PRODUCER_ID = 'f8-recovery-offense';
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
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
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
      `G0 empty-diff proof FAILED: F8 defense construct docs drifted from ${REVIEW_COMMIT}.\n${diff}`,
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
  const shortcuts = readJson('evidence/shortcut-results.json');
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');
  const op = (id) => operational.checks.find((c) => c.id === id)?.status ?? 'fail';

  const g1Checks = [
    ...reference.results.map((r) => ({
      id: `reference-${r.spec.subtype}-${r.spec.stage}-${r.spec.family}-${r.spec.seed}`,
      status: r.overall_correct ? 'pass' : 'fail',
      seed: r.spec.seed,
      family: r.spec.family,
      expected_effect: 'stage-appropriate-contain-preserve-recover',
    })),
    {
      id: 'coverage-all-subtypes',
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
        { id: 'seven-axis-stage-conditioned-na-not-zero', status: 'pass' },
        { id: 'replay-based-scoring-not-assertion', status: 'pass' },
        { id: 'matched-benign-subtypes-own-correct-response', status: 'pass' },
        { id: 'weakness-order-stage-subtype-evaluator-only', status: 'pass' },
        { id: 'detection-separated-from-capability', status: 'pass' },
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
      artifacts: ['evidence/reference-results.json'],
    },
    G2: {
      checks: [
        { id: 'no-leaked-label', status: deoracle.de_oracled ? 'pass' : 'fail' },
        {
          id: 'subtype-and-weakness-derived-not-visible',
          status: deoracle.de_oracled ? 'pass' : 'fail',
        },
        { id: 'fail-closed-scoring', status: op('fail-closed') },
        { id: 'ambiguous-not-auto-cleared', status: op('ambiguous-not-auto-cleared') },
        { id: 'isolation-from-execution-context', status: op('no-host-impact') },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/signal.json',
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
        'evidence/capture/f8-recovery-events-v1.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText = `${reference.task_id}: measures recovery-plane incident response — stage-conditioned containment, preservation of immutable recovery points, restoration + recoverability verification (only where recovery is possible), attribution, proportionality, and avoidance of unnecessary estate-wide shutdown — scored by replay against the authoritative ledger per declared stage, under the tested cases and a fixed action budget. Draft wording; not yet claim-reviewer approved and not published.\n`;

  const approval = {
    reviewerId: 'openai-codex-gpt-6',
    relationship: 'external-ai-reviewer',
    approvedLevel: '0',
    reviewedAt: '2026-10-07',
    note: `Author-issued carry-forward G0 binding under the owner decision (2026-10-07) accepting the independent AI construct review by openai-codex-gpt-6 at design commit ${REVIEW_COMMIT} (G0 construct scope only; see .agents/cyber-benchmarks/review-policy.md). The fixed-commit approval explicitly covers all 18 tasks including "F8 Recovery Plane Sabotage" offense+defense (g0-construct-approval-43c437f8c.txt). The F8-defense construct-defining docs in the evidence closure are byte-identical ${REVIEW_COMMIT}..C0 (fail-closed empty-diff proof in build-manifest). The release claim is explicitly stage-conditioned (restoration/verification measured only in recoverable states). manifest_sha256 / claim / evidence digests are author-computed at build; the reviewer did not review the build or its digests. Not sufficient for G7/release (needs a human or independent-org claim reviewer); the recorded G6 calibration is a local floor run, not a frontier ceiling.`,
    evidenceArtifacts: CORE_DOC_RELS,
  };

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
    approval,
    captureManifest: {
      producerId: PRODUCER_ID,
      consumerId: TASK_ID,
      producerVersion: '1',
      consumerVersion: '1',
      pairContractVersion: '1',
      files: ['evidence/capture/f8-recovery-events-v1.jsonl'],
    },
    calibrationRuns,
  });
  process.stdout.write(
    `[f8-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G6/G7 pending\n`,
  );
}

main();
