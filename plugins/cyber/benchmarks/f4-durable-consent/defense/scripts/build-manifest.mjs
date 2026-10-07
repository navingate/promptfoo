#!/usr/bin/env node
// F4 defense — bind generated evidence to an audited commit. G0 stays PENDING: label-policy.md +
// scoring-contract.md carry a post-approval SEMANTIC change (the `ambiguous` decision procedure,
// F2 Chain tip ab78f0a1d) to files the G0 reviewer specifically confirmed reading, so the F4-defense
// construct CANNOT be carried forward as "unchanged since 43c437f8c" — it needs the reviewer's
// re-read (flagged to the user). We therefore pass approval:null, and bindTask keeps G0 pending.
// G1-G5 bind model-free; G6/G7 stay pending. Run after generate-evidence.mjs + a format pass:
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
  const shortcuts = readJson('evidence/shortcut-results.json');
  const coverage = readJson('evidence/coverage-results.json');
  const operational = readJson('evidence/operational-results.json');
  const deoracle = readJson('evidence/deoracle-scan.json');
  const conformance = readJson('evidence/twin-conformance.json');
  const op = (id) => operational.checks.find((c) => c.id === id)?.status ?? 'fail';

  const g1Checks = [
    ...reference.results.map((r) => ({
      id: `reference-joiner-${r.family}-${r.seed}`,
      status: r.exact_key_match ? 'pass' : 'fail',
      seed: r.seed,
      family: r.family,
      expected_effect: 'reference-joiner-reproduces-evaluator-key',
    })),
    { id: 'coverage-all-classes', status: coverage.all_classes ? 'pass' : 'fail' },
    {
      id: 'coverage-all-counterexamples',
      status: coverage.all_counterexamples ? 'pass' : 'fail',
      detail: coverage.counterexamples.join(','),
    },
    {
      id: 'coverage-all-distractors',
      status: coverage.all_distractors ? 'pass' : 'fail',
      detail: coverage.distractors.join(','),
    },
  ];
  const g3Checks = [
    {
      id: 'reference-joiner-reproduces-key',
      status: reference.exact_key_matches === reference.total ? 'pass' : 'fail',
      detail: `${reference.exact_key_matches}/${reference.total}`,
    },
    ...shortcuts.baselines.map((b) => ({
      id: `shortcut-fails-${b.name}`,
      status: b.solves_construct ? 'fail' : 'pass',
      detail: `exact ${b.exact_instances}/${b.instances}`,
    })),
  ];
  const g5Checks = operational.checks.map((c) => ({ id: c.id, status: c.status, note: c.note }));

  const gates = {
    G0: {
      checks: [
        { id: 'single-primary-construct', status: 'pass' },
        { id: 'join-authorization-no-per-grant-flag', status: 'pass' },
        { id: 'matched-same-user-survivor', status: 'pass' },
        { id: 'detection-separated-from-remediation', status: 'pass' },
        { id: 'label-evaluator-only', status: 'pass' },
        // bindTask flips this to fail (approval:null) → G0 pending, pending the reviewer re-read of
        // the post-approval label-policy.md change (F2 Chain, tip ab78f0a1d).
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
        { id: 'authorization-is-a-visible-join', status: deoracle.de_oracled ? 'pass' : 'fail' },
        { id: 'fail-closed-scoring', status: op('fail-closed') },
        { id: 'isolation-from-execution-context', status: op('no-host-impact') },
      ],
      artifacts: [
        'evidence/deoracle-scan.json',
        'evidence/observation/grants.json',
        'evidence/observation/registry.json',
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
          id: 'scored-against-producer-frozen-corpus',
          status: conformance.corpus_conformant ? 'pass' : 'fail',
          detail: `${conformance.conformant_rows}/${conformance.total_rows}`,
        },
      ],
      artifacts: [
        'evidence/capture/f4-consent-corpus-v3.jsonl',
        'evidence/twin-conformance.json',
        'evidence/deoracle-scan.json',
      ],
    },
    G5: { checks: g5Checks, artifacts: ['evidence/operational-results.json'] },
  };

  const claimText = `${reference.task_id}: measures whether the model separates a malicious remediation-evading delegated grant from approved apps that legitimately survive the same user's reset, by a JOIN of grant facts against the model-visible registry + base policy, at the reported precision/recall; grant removal is a separate secondary axis. Draft wording; not yet claim-reviewer approved and not published.\n`;

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
      producerVersion: '3',
      consumerVersion: '3',
      pairContractVersion: '3',
      files: ['evidence/capture/f4-consent-corpus-v3.jsonl'],
    },
    approval: null, // G0 pending — see header: post-approval label-policy delta needs reviewer re-read
  });
  process.stdout.write(
    `[f4-defense] bound to ${commit.slice(0, 12)}… manifest_sha=${result.manifestSha.slice(0, 12)}… gate_statuses=${JSON.stringify(result.gateStatuses)}; G0 pending (label-policy delta), G6/G7 pending\n`,
  );
}

main();
