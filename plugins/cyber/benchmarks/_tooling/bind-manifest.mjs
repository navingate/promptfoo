// Shared commit-binding for a cyber benchmark task. Given a chosen audited commit,
// writes G0-G5 gate evidence, the staged-context inventory, any genuine construct
// approval, and the consumer capture manifest. A missing independent reviewer keeps
// G0 pending. G6/G7 remain pending until calibration and claim review.
//
// The commit is a label the auditor verifies by string equality against working-tree
// bytes; it is bound as the implementation commit whose frozen artifacts this evidence
// validates. A recorded approval is not promoted into manifest.approvals[] until
// achieved evidence exists after G6.

import fs from 'node:fs';
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
  const hasIndependentReviewer =
    config.approval?.reviewerId &&
    config.approval.reviewerId !== config.author &&
    !config.approval.reviewerId.startsWith('pending-');

  if (!hasIndependentReviewer && gates.G0) {
    for (const check of gates.G0.checks) {
      if (check.id === 'construct-review-recorded') {
        check.status = 'fail';
      }
    }
    gates.G0.artifacts = gates.G0.artifacts.filter(
      (rel) => rel !== 'evidence/approval-g0-construct.yml',
    );
  }

  for (const gate of Object.keys(gates)) {
    const allChecksPass = gates[gate].checks.every((check) => check.status === 'pass');
    // Always reference the gate's evidence file — it is written for every gate (below), and a
    // PENDING gate's partial evidence must stay auditable: the auditor's gate-matrix only emits
    // MODE_GATE_REQUIRED for a pending gate (it never inspects the evidence list), while
    // validateReferenceCoverage reads gates.G1.evidence to confirm the calibrated seeds/families
    // appear as PASSING reference checks. Emptying it on a legitimately-pending gate (e.g. F6
    // offense G1, which needs the pinned victim) would wrongly fail reference coverage for a
    // recorded floor-probe calibration whose per-seed plumbing checks do pass.
    manifest.gates[gate] = {
      status: allChecksPass ? 'pass' : 'pending',
      evidence: [`evidence/${gate.toLowerCase()}.yml`],
      waiver: null,
    };
  }
  manifest.contracts.staged_context_inventory = 'evidence/staged-context-inventory.yml';
  if (config.captureManifest) {
    manifest.contracts.capture_manifest = 'evidence/capture-manifest.yml';
  }
  // G6 calibration run records (written by the runner into calibration/). The protocol +
  // result paths are already declared in the manifest; this wires in the recorded run(s) so
  // the manifest digest covers them. The G6 gate status is NOT flipped here — it stays
  // pending until a frontier ceiling run; the recorded local run is floor/middle evidence.
  if (Array.isArray(config.calibrationRuns)) {
    manifest.calibration = manifest.calibration ?? {};
    manifest.calibration.runs = config.calibrationRuns;
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
  if (hasIndependentReviewer) {
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
  } else {
    fs.rmSync(path.join(taskDir, 'evidence/approval-g0-construct.yml'), { force: true });
  }

  // Gate evidence written LAST so G0 can bind the approval file's digest.
  for (const [gate, spec] of Object.entries(gates)) {
    const artifacts = spec.artifacts.map((rel) => artifactRef(taskDir, rel));
    const doc = gateEvidenceDoc({ gate, taskId, commit, checks: spec.checks, artifacts });
    writeYaml(path.join(taskDir, `evidence/${gate.toLowerCase()}.yml`), doc);
  }

  return {
    manifestSha,
    claimSha,
    gateStatuses: Object.fromEntries(
      Object.keys(gates).map((gate) => [gate, manifest.gates[gate].status]),
    ),
  };
}
