// Shared commit-binding for a cyber benchmark task. Given a chosen audited commit,
// writes the G0-G5 gate evidence, the harness staged-context inventory, the recorded
// construct-review (G0) approval, and (for a paired consumer) the capture manifest,
// then flips G0-G5 to `pass` in benchmark.yml. G6 (calibration) and G7 (claim) stay
// `pending` by design — that is the intended unreleasable, pre-calibration state.
//
// The commit is a label the auditor verifies by string equality against working-tree
// bytes; it is bound as the implementation commit whose frozen artifacts this evidence
// validates. The recorded approval is NOT added to manifest.approvals[] (the auditor
// ties any listed approval to an achieved evidence level, which only exists after G6).

import path from 'node:path';

import {
  approvalDoc,
  artifactRef,
  gateEvidenceDoc,
  readYaml,
  sha256File,
  writeText,
  writeYaml,
} from './evidence-lib.mjs';

const GENERATOR = { id: 'cyber-benchmark-evidence-generator', version: '1' };

function flattenObservationSources(observation) {
  const grouped = observation.sources ?? {};
  const fileGroups = [
    'prompts',
    'files',
    'telemetry',
    'tool_descriptions',
    'feedback',
    'artifacts',
    'serialized_results',
  ];
  const sources = [];
  for (const group of fileGroups) {
    for (const entry of grouped[group] ?? []) {
      sources.push({ group, path: entry.path, sha256: entry.sha256 });
    }
  }
  const environment = (grouped.environment ?? []).map((e) => ({
    group: 'environment',
    name: e.name,
    classification: e.classification,
    value_sha256: e.value_sha256,
  }));
  return { sources, environment };
}

function writeStagedContextInventory(taskDir, taskId, commit) {
  const observation = readYaml(path.join(taskDir, 'observation-plane.yml'));
  const { sources, environment } = flattenObservationSources(observation);
  const inventory = {
    schema_version: 1,
    generator: GENERATOR,
    task_id: taskId,
    commit,
    fully_staged_context_sha256: observation.fully_staged_context_sha256,
    sources: [...sources, ...environment],
  };
  writeYaml(path.join(taskDir, 'evidence/staged-context-inventory.yml'), inventory);
}

function writeCaptureManifest(taskDir, commit, spec) {
  const capture = {
    schema_version: 1,
    task_id: spec.consumerId,
    source_commit: commit,
    designation: 'estate-generated',
    redaction_status: 'reviewed',
    pair_contract_version: spec.pairContractVersion,
    consumer: { task_id: spec.consumerId, version: spec.consumerVersion },
    producer: { task_id: spec.producerId, version: spec.producerVersion },
    field_lineage: 'field-lineage.yml',
    files: spec.files.map((rel) => artifactRef(taskDir, rel)),
  };
  writeYaml(path.join(taskDir, 'evidence/capture-manifest.yml'), capture);
}

/**
 * Bind a task to `commit` and record G0-G5 evidence.
 *
 * config = { taskDir, taskId, commit, author, gates, approval, captureManifest?, claimText }
 *  - gates: { G0..G5: { checks: [...], artifacts: ['task-relative', ...] } }
 *  - approval: { reviewerId, relationship, approvedLevel, evidenceArtifacts: [...] }
 *  - captureManifest?: { producerId, consumerId, producerVersion, consumerVersion,
 *                        pairContractVersion, files: [...] }
 */
export function bindTask(config) {
  const { taskDir, taskId, commit, gates } = config;
  const manifest = readYaml(path.join(taskDir, 'benchmark.yml'));
  manifest.implementation.commit = commit;

  for (const gate of Object.keys(gates)) {
    manifest.gates[gate] = {
      status: 'pass',
      evidence: [`evidence/${gate.toLowerCase()}.yml`],
      waiver: null,
    };
  }
  manifest.contracts.staged_context_inventory = 'evidence/staged-context-inventory.yml';
  if (config.captureManifest) {
    manifest.contracts.capture_manifest = 'evidence/capture-manifest.yml';
  }
  writeYaml(path.join(taskDir, 'benchmark.yml'), manifest);
  const manifestSha = sha256File(path.join(taskDir, 'benchmark.yml'));

  // Draft publishable claim (NOT yet claim-reviewer approved; not in approvals[]).
  if (config.claimText != null) {
    writeText(path.join(taskDir, 'evidence/approved-claim.txt'), config.claimText);
  }
  const claimSha = sha256File(path.join(taskDir, 'evidence/approved-claim.txt'));

  writeStagedContextInventory(taskDir, taskId, commit);
  if (config.captureManifest) {
    writeCaptureManifest(taskDir, commit, config.captureManifest);
  }

  // Recorded construct-review (G0) decision, bound to this commit/manifest/claim.
  const evidenceSha = Object.fromEntries(
    (config.approval.evidenceArtifacts ?? []).map((rel) => [
      rel,
      sha256File(path.join(taskDir, rel)),
    ]),
  );
  const approval = approvalDoc({
    approvalId: `${taskId}-construct-g0`,
    taskId,
    role: 'construct-reviewer',
    reviewerId: config.approval.reviewerId,
    authorId: config.author,
    relationship: config.approval.relationship,
    reviewedCommit: commit,
    manifestSha256: manifestSha,
    evidenceSha256: evidenceSha,
    claimTextSha256: claimSha,
    approvedEvidenceLevel: config.approval.approvedLevel,
    reviewedAt: config.approval.reviewedAt,
    note: config.approval.note,
  });
  writeYaml(path.join(taskDir, 'evidence/approval-g0-construct.yml'), approval);

  // Gate evidence written LAST so G0 can bind the approval file's digest.
  for (const [gate, spec] of Object.entries(gates)) {
    const artifacts = spec.artifacts.map((rel) => artifactRef(taskDir, rel));
    const doc = gateEvidenceDoc({ gate, taskId, commit, checks: spec.checks, artifacts });
    writeYaml(path.join(taskDir, `evidence/${gate.toLowerCase()}.yml`), doc);
  }

  return { manifestSha, claimSha };
}
