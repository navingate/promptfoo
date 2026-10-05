#!/usr/bin/env node

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditResult,
  DEFAULT_LIMITS,
  isMapping,
  loadMapping,
  printResult,
  sha256File,
} from './lib/manifest.mjs';
import { canonicalRoot, readRegularFile, resolveInside } from './lib/safe-path.mjs';

const LEVELS = ['0', '1', '2', '3A', '3B', '3A+3B', '4'];
const MODES = ['offense-capability', 'defense-detection', 'incident-response', 'tool-conduct'];
const APPROVAL_ROLES = new Set([
  'construct-reviewer',
  'implementation-reviewer',
  'grounding-reviewer',
  'claim-reviewer',
  'gate-waiver-reviewer',
  'transfer-reviewer',
]);
const OPTIONAL_GATES = {
  'offense-capability': new Set(['G4', 'G5']),
  'defense-detection': new Set(['G5']),
  'incident-response': new Set(['G4']),
  'tool-conduct': new Set(['G4']),
};
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function addFinding(findings, code, findingPath, message, severity = 'error') {
  if (findings.length <= DEFAULT_LIMITS.maxFindings) {
    findings.push({ code, severity, path: findingPath, message });
  }
}

function validId(value) {
  return typeof value === 'string' && value.length <= 128 && SAFE_ID.test(value);
}

function validLevel(value) {
  return typeof value === 'string' && LEVELS.includes(value);
}

function levelSupports(computed, claimed) {
  if (computed === claimed) {
    return true;
  }
  if (claimed === '0') {
    return true;
  }
  if (computed === '4') {
    return true;
  }
  if (computed === '3A+3B') {
    return ['1', '2', '3A', '3B'].includes(claimed);
  }
  if (computed === '3A') {
    return ['1', '2'].includes(claimed) || claimed === '3A';
  }
  if (computed === '3B') {
    return ['1', '2'].includes(claimed) || claimed === '3B';
  }
  if (computed === '2') {
    return ['1', '2'].includes(claimed);
  }
  return computed === '1' && claimed === '1';
}

function taskReference(value, field, findings) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    addFinding(findings, 'MANIFEST_INVALID', field, 'Expected a bounded task-relative path');
    return null;
  }
  if (/[\x00-\x1f\x7f\\]/u.test(value)) {
    addFinding(findings, 'PATH_OUTSIDE_TASK', field, 'Task-local path contains unsafe characters');
    return null;
  }
  return value;
}

function readTaskFile(taskRoot, reference, field, findings, maxBytes = MAX_ARTIFACT_BYTES) {
  const relativePath = taskReference(reference, field, findings);
  if (!relativePath) {
    return null;
  }
  try {
    return readRegularFile(taskRoot, relativePath, { maxBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /relative|outside|traversal|symlink/u.test(message)
      ? 'PATH_OUTSIDE_TASK'
      : 'EVIDENCE_FILE_MISSING';
    addFinding(findings, code, field, 'Referenced task-local file is unavailable or unsafe');
    return null;
  }
}

function loadTaskMapping(taskRoot, reference, field, findings) {
  const relativePath = taskReference(reference, field, findings);
  if (!relativePath) {
    return null;
  }
  try {
    return loadMapping(taskRoot, relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /relative|outside|traversal|symlink/u.test(message)
      ? 'PATH_OUTSIDE_TASK'
      : 'MANIFEST_INVALID';
    addFinding(findings, code, field, 'Referenced task-local manifest is invalid or unsafe');
    return null;
  }
}

function verifyTaskDigest(taskRoot, reference, expectedDigest, field, findings) {
  const relativePath = taskReference(reference, field, findings);
  if (!relativePath) {
    return false;
  }
  let actualDigest;
  try {
    actualDigest = sha256File(taskRoot, relativePath);
  } catch {
    addFinding(
      findings,
      'EVIDENCE_FILE_MISSING',
      field,
      'Referenced task-local file is unavailable or unsafe',
    );
    return false;
  }
  if (!SHA256.test(expectedDigest ?? '') || actualDigest !== expectedDigest) {
    addFinding(
      findings,
      'EVIDENCE_DIGEST_STALE',
      field,
      'Artifact digest does not match current bytes',
    );
    return false;
  }
  return true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Evidence closure is intentionally explicit and fail-closed.
function collectEvidenceReferences(manifest, findings) {
  const references = new Set();
  const gates = isMapping(manifest.gates) ? manifest.gates : {};
  for (const gateId of Array.from({ length: 8 }, (_, index) => `G${index}`)) {
    const gate = gates[gateId];
    if (!isMapping(gate)) {
      continue;
    }
    if (Array.isArray(gate.evidence)) {
      for (const [index, reference] of gate.evidence.entries()) {
        const valid = taskReference(reference, `gates.${gateId}.evidence[${index}]`, findings);
        if (valid) {
          references.add(valid);
        }
      }
    }
    if (gate.waiver !== null && gate.waiver !== undefined) {
      const valid = taskReference(gate.waiver, `gates.${gateId}.waiver`, findings);
      if (valid) {
        references.add(valid);
      }
    }
  }

  const calibration = isMapping(manifest.calibration) ? manifest.calibration : {};
  for (const [field, value] of [
    ['calibration.protocol', calibration.protocol],
    ['calibration.result', calibration.result],
  ]) {
    if (value !== null && value !== undefined) {
      const valid = taskReference(value, field, findings);
      if (valid) {
        references.add(valid);
      }
    }
  }
  if (Array.isArray(calibration.runs)) {
    for (const [index, value] of calibration.runs.entries()) {
      const valid = taskReference(value, `calibration.runs[${index}]`, findings);
      if (valid) {
        references.add(valid);
      }
    }
  }

  const contracts = isMapping(manifest.contracts) ? manifest.contracts : {};
  for (const key of [
    'observation_plane',
    'staged_context_inventory',
    'forbidden_inventory',
    'field_lineage',
    'capture_manifest',
    'external_grounding',
    'transfer_evidence',
  ]) {
    if (contracts[key] !== null && contracts[key] !== undefined) {
      const valid = taskReference(contracts[key], `contracts.${key}`, findings);
      if (valid) {
        references.add(valid);
      }
    }
  }
  if (
    isMapping(manifest.evidence) &&
    manifest.evidence.level2 !== null &&
    manifest.evidence.level2 !== undefined
  ) {
    const valid = taskReference(manifest.evidence.level2, 'evidence.level2', findings);
    if (valid) {
      references.add(valid);
    }
  }
  return references;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Gate validation keeps each security prerequisite visible.
function validateGateMatrix(manifest, taskRoot, commit, findings) {
  if (!isMapping(manifest.gates)) {
    addFinding(findings, 'MANIFEST_INVALID', 'gates', 'Gates must be a mapping');
    return false;
  }
  let allSatisfied = true;
  const optional = OPTIONAL_GATES[manifest.mode] ?? new Set();
  const paired = isMapping(manifest.pairing);

  for (let index = 0; index < 8; index += 1) {
    const gateId = `G${index}`;
    const gate = manifest.gates[gateId];
    if (!isMapping(gate) || !['pending', 'pass', 'not_applicable'].includes(gate.status)) {
      addFinding(findings, 'MANIFEST_INVALID', `gates.${gateId}`, 'Gate has an invalid status');
      allSatisfied = false;
      continue;
    }
    if (!Array.isArray(gate.evidence)) {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        `gates.${gateId}.evidence`,
        'Gate evidence must be an array',
      );
      allSatisfied = false;
      continue;
    }
    if (gate.status === 'pending') {
      addFinding(
        findings,
        'MODE_GATE_REQUIRED',
        `gates.${gateId}`,
        'Required gate remains pending',
      );
      allSatisfied = false;
    } else if (gate.status === 'pass') {
      if (gate.evidence.length === 0) {
        addFinding(
          findings,
          'EVIDENCE_FILE_MISSING',
          `gates.${gateId}`,
          'Passing gate has no evidence',
        );
        allSatisfied = false;
      }
      for (const [evidenceIndex, reference] of gate.evidence.entries()) {
        const evidenceField = `gates.${gateId}.evidence[${evidenceIndex}]`;
        const evidence = loadTaskMapping(taskRoot, reference, evidenceField, findings);
        if (!evidence) {
          allSatisfied = false;
          continue;
        }
        if (
          evidence.schema_version !== 1 ||
          evidence.gate !== gateId ||
          evidence.task_id !== manifest.id ||
          evidence.commit !== commit ||
          !Array.isArray(evidence.checks) ||
          evidence.checks.length === 0 ||
          evidence.checks.some((check) => !isMapping(check) || check.status !== 'pass') ||
          !Array.isArray(evidence.artifacts)
        ) {
          addFinding(
            findings,
            'EVIDENCE_DIGEST_STALE',
            evidenceField,
            'Gate evidence identity, checks, or commit is incomplete',
          );
          allSatisfied = false;
        }
        for (const [artifactIndex, artifact] of (evidence.artifacts ?? []).entries()) {
          if (
            !isMapping(artifact) ||
            !verifyTaskDigest(
              taskRoot,
              artifact.path,
              artifact.sha256,
              `${evidenceField}.artifacts[${artifactIndex}]`,
              findings,
            )
          ) {
            allSatisfied = false;
          }
        }
      }
    } else {
      const permitted = optional.has(gateId) && !(paired && gateId === 'G4');
      if (!permitted || gate.waiver === null || gate.waiver === undefined) {
        addFinding(
          findings,
          'GATE_WAIVER_INVALID',
          `gates.${gateId}`,
          'Gate waiver is absent or not permitted',
        );
        allSatisfied = false;
      } else {
        const waiver = loadTaskMapping(taskRoot, gate.waiver, `gates.${gateId}.waiver`, findings);
        if (
          !waiver ||
          waiver.gate !== gateId ||
          typeof waiver.rationale !== 'string' ||
          !waiver.approval
        ) {
          addFinding(
            findings,
            'GATE_WAIVER_INVALID',
            `gates.${gateId}.waiver`,
            'Waiver does not bind this gate and rationale',
          );
          allSatisfied = false;
        }
      }
    }
  }
  return allSatisfied;
}

function validateApprovals(
  manifest,
  taskRoot,
  commit,
  manifestDigest,
  evidenceReferences,
  findings,
) {
  const approvals = new Map();
  const approvalIds = new Set();
  const authorId = isMapping(manifest.owner) ? manifest.owner.author_id : undefined;
  const claimPath = isMapping(manifest.claims) ? manifest.claims.approved_text_path : undefined;
  const claimText = readTaskFile(taskRoot, claimPath, 'claims.approved_text_path', findings);
  const claimDigest = claimText === null ? null : hashText(claimText);

  if (!Array.isArray(manifest.approvals)) {
    addFinding(findings, 'MANIFEST_INVALID', 'approvals', 'Approvals must be an array');
    return { approvals, claimDigest, valid: false };
  }

  for (const [index, reference] of manifest.approvals.entries()) {
    const field = `approvals[${index}]`;
    const approval = loadTaskMapping(taskRoot, reference, field, findings);
    let valid = true;
    if (!approval) {
      continue;
    }
    if (!validId(approval.approval_id) || approvalIds.has(approval.approval_id)) {
      addFinding(findings, 'APPROVAL_INVALID', field, 'Approval ID is invalid or duplicated');
      valid = false;
    } else {
      approvalIds.add(approval.approval_id);
    }
    if (!APPROVAL_ROLES.has(approval.role)) {
      addFinding(findings, 'APPROVAL_INVALID', field, 'Approval role is not permitted');
      valid = false;
    }
    if (
      approval.task_id !== manifest.id ||
      approval.author_id !== authorId ||
      !validId(approval.reviewer_id) ||
      approval.reviewer_id === authorId ||
      approval.independent !== true ||
      approval.decision !== 'approved'
    ) {
      addFinding(
        findings,
        'APPROVAL_INVALID',
        field,
        'Approval identity, task scope, or decision is invalid',
      );
      valid = false;
    }
    if (
      approval.reviewed_commit !== commit ||
      approval.manifest_sha256 !== manifestDigest ||
      approval.claim_text_sha256 !== claimDigest ||
      !validLevel(approval.approved_evidence_level) ||
      approval.approved_evidence_level !== manifest.evidence?.achieved_evidence_level
    ) {
      addFinding(
        findings,
        'APPROVAL_STALE',
        field,
        'Approval does not bind the current commit, manifest, claim, and level',
      );
      valid = false;
    }
    if (isMapping(approval.evidence_sha256)) {
      for (const evidencePath of evidenceReferences) {
        const expectedDigest = approval.evidence_sha256[evidencePath];
        if (
          !verifyTaskDigest(
            taskRoot,
            evidencePath,
            expectedDigest,
            `${field}.evidence_sha256.${evidencePath}`,
            findings,
          )
        ) {
          valid = false;
        }
      }
    } else {
      addFinding(findings, 'APPROVAL_STALE', field, 'Approval evidence closure is absent');
      valid = false;
    }
    if (valid) {
      if (!approvals.has(approval.role)) {
        approvals.set(approval.role, []);
      }
      approvals.get(approval.role).push(approval);
    }
  }
  return { approvals, claimDigest, valid: true };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Calibration validation reconciles independent evidence dimensions.
function validateCalibration(manifest, taskRoot, commit, findings) {
  const calibration = manifest.calibration;
  if (!isMapping(calibration) || !Array.isArray(calibration.runs)) {
    addFinding(
      findings,
      'CALIBRATION_INCOMPLETE',
      'calibration',
      'Calibration contract is invalid',
    );
    return false;
  }
  if (calibration.runs.length === 0) {
    return false;
  }
  let valid = true;
  const runs = [];
  for (const [index, reference] of calibration.runs.entries()) {
    const field = `calibration.runs[${index}]`;
    const run = loadTaskMapping(taskRoot, reference, field, findings);
    if (!run) {
      valid = false;
      continue;
    }
    runs.push({ reference, run });
    if (run.task_id !== manifest.id || run.commit !== commit || !validId(run.run_id)) {
      valid = false;
    }
    if (!isMapping(run.model) || !isMapping(run.harness) || !isMapping(run.opportunity_budget)) {
      valid = false;
    }
    if (
      !Array.isArray(run.seeds) ||
      new Set(run.seeds).size < 2 ||
      !Array.isArray(run.families) ||
      run.families.length === 0 ||
      !Array.isArray(run.instance_ids) ||
      run.instance_ids.length === 0 ||
      new Set(run.instance_ids).size !== run.instance_ids.length
    ) {
      valid = false;
    }
    const attempts = run.attempts;
    const outcomes = run.outcomes;
    if (!isMapping(attempts) || !isMapping(outcomes)) {
      valid = false;
    } else {
      const numbers = [
        attempts.declared_minimum,
        attempts.completed,
        attempts.model_failures,
        attempts.provider_errors,
        attempts.invalid_runs,
        outcomes.pass,
        outcomes.fail,
      ];
      if (!numbers.every((value) => Number.isSafeInteger(value) && value >= 0)) {
        valid = false;
      } else if (
        attempts.completed < attempts.declared_minimum ||
        outcomes.pass + outcomes.fail !== attempts.completed ||
        attempts.model_failures !== outcomes.fail
      ) {
        valid = false;
      }
    }
    if (isMapping(run.stage_survival)) {
      let previous = Number.POSITIVE_INFINITY;
      for (const value of Object.values(run.stage_survival)) {
        if (
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > previous ||
          value > (attempts?.completed ?? 0)
        ) {
          valid = false;
        }
        previous = value;
      }
    } else {
      valid = false;
    }
    if (isMapping(run.artifacts)) {
      for (const name of ['config', 'prompt', 'raw_output', 'summarized_output']) {
        const artifact = run.artifacts[name];
        if (
          !isMapping(artifact) ||
          !artifact.path ||
          !verifyTaskDigest(
            taskRoot,
            artifact.path,
            artifact.sha256,
            `${field}.artifacts.${name}`,
            findings,
          )
        ) {
          valid = false;
        }
      }
    } else {
      valid = false;
    }
    if (!valid) {
      addFinding(
        findings,
        'CALIBRATION_INCOMPLETE',
        field,
        'Calibration run is incomplete, inconsistent, or stale',
      );
    }
  }

  const protocol = loadTaskMapping(
    taskRoot,
    calibration.protocol,
    'calibration.protocol',
    findings,
  );
  const result = loadTaskMapping(taskRoot, calibration.result, 'calibration.result', findings);
  if (
    !protocol ||
    protocol.schema_version !== 1 ||
    protocol.task_id !== manifest.id ||
    protocol.commit !== commit ||
    !result ||
    result.schema_version !== 1 ||
    result.task_id !== manifest.id ||
    result.commit !== commit ||
    !isMapping(result.protocol) ||
    result.protocol.path !== calibration.protocol ||
    !verifyTaskDigest(
      taskRoot,
      result.protocol.path,
      result.protocol.sha256,
      'calibration.result.protocol',
      findings,
    ) ||
    !Array.isArray(result.runs) ||
    result.runs.length !== calibration.runs.length ||
    !isMapping(result.declared_minimum) ||
    !isMapping(result.completed) ||
    !isMapping(result.outcome_counts) ||
    !isMapping(result.uncertainty) ||
    typeof result.uncertainty.method !== 'string' ||
    typeof result.uncertainty.result !== 'string' ||
    !Array.isArray(result.limitations) ||
    result.limitations.length === 0 ||
    result.minima_met !== true
  ) {
    valid = false;
  }

  if (result && Array.isArray(result.runs)) {
    for (const [index, runBinding] of result.runs.entries()) {
      if (
        !isMapping(runBinding) ||
        runBinding.path !== calibration.runs[index] ||
        !verifyTaskDigest(
          taskRoot,
          runBinding.path,
          runBinding.sha256,
          `calibration.result.runs[${index}]`,
          findings,
        )
      ) {
        valid = false;
      }
    }
  }

  const aggregate = runs.reduce(
    (totals, { run }) => {
      for (const instanceId of run.instance_ids ?? []) {
        totals.instances.add(instanceId);
      }
      totals.validAttempts += run.attempts?.completed ?? 0;
      totals.pass += run.outcomes?.pass ?? 0;
      totals.fail += run.outcomes?.fail ?? 0;
      totals.providerErrors += run.attempts?.provider_errors ?? 0;
      totals.invalidRuns += run.attempts?.invalid_runs ?? 0;
      return totals;
    },
    {
      instances: new Set(),
      validAttempts: 0,
      pass: 0,
      fail: 0,
      providerErrors: 0,
      invalidRuns: 0,
    },
  );
  const summaryNumbers = [
    result?.declared_minimum?.instances,
    result?.declared_minimum?.attempts,
    result?.completed?.instances,
    result?.completed?.valid_attempts,
    result?.outcome_counts?.pass,
    result?.outcome_counts?.fail,
    result?.outcome_counts?.provider_errors,
    result?.outcome_counts?.invalid_runs,
  ];
  if (
    !summaryNumbers.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    result?.completed?.instances !== aggregate.instances.size ||
    result?.completed?.valid_attempts !== aggregate.validAttempts ||
    result?.outcome_counts?.pass !== aggregate.pass ||
    result?.outcome_counts?.fail !== aggregate.fail ||
    result?.outcome_counts?.provider_errors !== aggregate.providerErrors ||
    result?.outcome_counts?.invalid_runs !== aggregate.invalidRuns ||
    result?.completed?.instances < result?.declared_minimum?.instances ||
    result?.completed?.valid_attempts < result?.declared_minimum?.attempts
  ) {
    valid = false;
  }
  if (!valid) {
    addFinding(
      findings,
      'CALIBRATION_INCOMPLETE',
      'calibration.result',
      'Calibration result does not reconcile protocol, runs, minima, outcomes, and uncertainty',
    );
  }
  return valid;
}

function validateReferenceCoverage(manifest, taskRoot, findings) {
  const requiredSeeds = new Set();
  const requiredFamilies = new Set();
  for (const [index, reference] of (manifest.calibration?.runs ?? []).entries()) {
    const run = loadTaskMapping(taskRoot, reference, `calibration.runs[${index}]`, findings);
    for (const seed of run?.seeds ?? []) {
      requiredSeeds.add(seed);
    }
    for (const family of run?.families ?? []) {
      requiredFamilies.add(family);
    }
  }
  const coveredSeeds = new Set();
  const coveredFamilies = new Set();
  for (const [index, reference] of (manifest.gates?.G1?.evidence ?? []).entries()) {
    const evidence = loadTaskMapping(taskRoot, reference, `gates.G1.evidence[${index}]`, findings);
    for (const check of evidence?.checks ?? []) {
      if (check?.status !== 'pass') {
        continue;
      }
      if (check.seed !== undefined) {
        coveredSeeds.add(check.seed);
      }
      if (check.family !== undefined) {
        coveredFamilies.add(check.family);
      }
    }
  }
  const valid =
    [...requiredSeeds].every((seed) => coveredSeeds.has(seed)) &&
    [...requiredFamilies].every((family) => coveredFamilies.has(family));
  if (!valid) {
    addFinding(
      findings,
      'REFERENCE_COVERAGE_INCOMPLETE',
      'gates.G1',
      'Reference evidence does not cover every calibrated seed and family',
    );
  }
  return valid;
}

function validateSuite(root, _taskRoot, taskRelative, manifest, suiteReference, commit, findings) {
  if (!suiteReference) {
    return { record: null, reciprocal: !manifest.pairing, valid: true };
  }
  let suite;
  try {
    suite = loadMapping(root, suiteReference);
  } catch {
    addFinding(findings, 'MANIFEST_INVALID', 'suite', 'Suite registry is unavailable or invalid');
    return { record: null, reciprocal: false, valid: false };
  }
  if (!Array.isArray(suite.benchmarks)) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'suite.benchmarks',
      'Suite benchmarks must be an array',
    );
    return { record: null, reciprocal: false, valid: false };
  }
  const ids = new Set();
  const constructs = new Set();
  for (const [index, record] of suite.benchmarks.entries()) {
    if (!isMapping(record) || !validId(record.id) || ids.has(record.id)) {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        `suite.benchmarks[${index}]`,
        'Suite benchmark ID is invalid or duplicated',
      );
      continue;
    }
    ids.add(record.id);
    if (!validId(record.primary_construct_id) || constructs.has(record.primary_construct_id)) {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        `suite.benchmarks[${index}].primary_construct_id`,
        'Primary construct ID is invalid or duplicated',
      );
    }
    constructs.add(record.primary_construct_id);
  }
  const record = suite.benchmarks.find(
    (candidate) => isMapping(candidate) && candidate.id === manifest.id,
  );
  const expectedGateStatuses = Object.fromEntries(
    Object.entries(manifest.gates ?? {}).map(([gateId, gate]) => [gateId, gate?.status]),
  );
  const expectedClaimPath = `${taskRelative}/${manifest.claims?.approved_text_path}`;
  const recordValid = !(
    !record ||
    record.path !== taskRelative ||
    record.primary_construct_id !== manifest.primary_construct_id ||
    record.mode_profile !== manifest.mode ||
    record.primary_coverage !== manifest.primary_coverage ||
    JSON.stringify(record.secondary_coverage) !== JSON.stringify(manifest.secondary_coverage) ||
    record.intended_evidence_level !== manifest.evidence?.intended_evidence_level ||
    record.achieved_evidence_level !== manifest.evidence?.achieved_evidence_level ||
    record.approved_claim_path !== expectedClaimPath ||
    JSON.stringify(record.explicit_nonclaims) !== JSON.stringify(manifest.claims?.nonclaims) ||
    JSON.stringify(record.gates) !== JSON.stringify(expectedGateStatuses) ||
    record.paired_task_id !== (manifest.pairing?.paired_task_id ?? null)
  );
  if (!recordValid) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'suite',
      'Suite record does not bind the audited task, evidence, gates, claim, and pairing',
    );
  }

  if (!isMapping(manifest.pairing)) {
    return { record, reciprocal: true, valid: recordValid };
  }
  const pairRecord = suite.benchmarks.find(
    (candidate) => isMapping(candidate) && candidate.id === manifest.pairing.paired_task_id,
  );
  if (!pairRecord || typeof pairRecord.path !== 'string') {
    addFinding(findings, 'PAIR_NOT_RECIPROCAL', 'pairing', 'Paired task is absent from the suite');
    return { record, reciprocal: false, valid: false };
  }
  let pairedManifest;
  try {
    const pairedRoot = resolveInside(root, pairRecord.path);
    const pairedRelative = path.relative(root, pairedRoot).split(path.sep).join('/');
    pairedManifest = loadMapping(root, `${pairedRelative}/benchmark.yml`);
  } catch {
    addFinding(
      findings,
      'PAIR_NOT_RECIPROCAL',
      'pairing',
      'Paired task manifest is unavailable or unsafe',
    );
    return { record, reciprocal: false, valid: false };
  }
  const expectedRole = manifest.pairing.paired_role === 'producer' ? 'consumer' : 'producer';
  if (
    !isMapping(pairedManifest.pairing) ||
    pairedManifest.pairing.paired_task_id !== manifest.id ||
    pairedManifest.pairing.paired_role !== expectedRole ||
    pairedManifest.pairing.pair_contract_version !== manifest.pairing.pair_contract_version ||
    pairedManifest.implementation?.commit !== commit
  ) {
    addFinding(
      findings,
      'PAIR_NOT_RECIPROCAL',
      'pairing',
      'Paired task IDs, roles, contract, or commit do not agree',
    );
    return { record, reciprocal: false, valid: false };
  }
  return { record, reciprocal: true, valid: recordValid };
}

function validateFileBindings(taskRoot, files, field, findings) {
  if (!Array.isArray(files) || files.length === 0) {
    addFinding(findings, 'CAPTURE_BINDING_STALE', field, 'Grounding evidence has no bound files');
    return false;
  }
  let valid = true;
  for (const [index, entry] of files.entries()) {
    if (
      !isMapping(entry) ||
      !verifyTaskDigest(taskRoot, entry.path, entry.sha256, `${field}.files[${index}]`, findings)
    ) {
      valid = false;
    }
  }
  if (!valid) {
    addFinding(findings, 'CAPTURE_BINDING_STALE', field, 'A grounded file is missing or stale');
  }
  return valid;
}

function validateCaptureManifest(manifest, taskRoot, commit, findings) {
  const reference = manifest.contracts?.capture_manifest;
  if (typeof reference !== 'string') {
    return false;
  }
  const capture = loadTaskMapping(taskRoot, reference, 'contracts.capture_manifest', findings);
  if (!capture) {
    return false;
  }
  let valid = true;
  if (
    capture.schema_version !== 1 ||
    capture.task_id !== manifest.id ||
    capture.source_commit !== commit ||
    capture.designation !== 'estate-generated' ||
    capture.redaction_status !== 'reviewed' ||
    capture.pair_contract_version !== manifest.pairing?.pair_contract_version ||
    capture.consumer?.task_id !== manifest.id ||
    capture.producer?.task_id !== manifest.pairing?.paired_task_id ||
    typeof capture.consumer?.version !== 'string' ||
    typeof capture.producer?.version !== 'string' ||
    capture.field_lineage !== manifest.contracts?.field_lineage
  ) {
    valid = false;
  }
  if (!validateFileBindings(taskRoot, capture.files, 'contracts.capture_manifest', findings)) {
    valid = false;
  }
  if (!valid) {
    addFinding(
      findings,
      'CAPTURE_BINDING_STALE',
      'contracts.capture_manifest',
      'Capture metadata does not bind the current pair, commit, redaction, lineage, and files',
    );
  }
  return valid;
}

function requireTaskReference(taskRoot, reference, field, findings) {
  return readTaskFile(taskRoot, reference, field, findings) !== null;
}

function validateExternalGrounding(manifest, taskRoot, findings) {
  const reference = manifest.contracts?.external_grounding;
  if (typeof reference !== 'string') {
    return false;
  }
  const external = loadTaskMapping(taskRoot, reference, 'contracts.external_grounding', findings);
  if (!external) {
    return false;
  }
  let valid = true;
  if (
    external.schema_version !== 1 ||
    !isMapping(external.source) ||
    typeof external.source.name !== 'string' ||
    typeof external.source.version !== 'string' ||
    typeof external.source.provenance_url !== 'string' ||
    !isMapping(external.license_and_collection) ||
    typeof external.license_and_collection.license !== 'string' ||
    typeof external.license_and_collection.collection_constraints !== 'string' ||
    !isMapping(external.labels) ||
    !Array.isArray(external.sampling_limitations) ||
    external.sampling_limitations.length === 0
  ) {
    valid = false;
  }
  for (const [field, nestedReference] of [
    ['labels.validation_report', external.labels?.validation_report],
    ['labels.schema_mapping', external.labels?.schema_mapping],
    ['contamination_assessment', external.contamination_assessment],
    ['coverage_analysis', external.coverage_analysis],
  ]) {
    if (
      !requireTaskReference(
        taskRoot,
        nestedReference,
        `contracts.external_grounding.${field}`,
        findings,
      )
    ) {
      valid = false;
    }
  }
  if (!validateFileBindings(taskRoot, external.files, 'contracts.external_grounding', findings)) {
    valid = false;
  }
  if (!valid) {
    addFinding(
      findings,
      'CAPTURE_BINDING_STALE',
      'contracts.external_grounding',
      'External grounding provenance, labels, coverage, or file bindings are incomplete',
    );
  }
  return valid;
}

function validateTransferEvidence(manifest, taskRoot, sourceLevel, findings) {
  const reference = manifest.contracts?.transfer_evidence;
  if (typeof reference !== 'string') {
    return false;
  }
  const transfer = loadTaskMapping(taskRoot, reference, 'contracts.transfer_evidence', findings);
  if (!transfer) {
    return false;
  }
  let valid = true;
  if (
    transfer.schema_version !== 1 ||
    transfer.source_level !== sourceLevel ||
    !isMapping(transfer.environment) ||
    typeof transfer.environment.id !== 'string' ||
    !['independently-sourced', 'operationally-representative'].includes(
      transfer.environment.relationship,
    ) ||
    !Array.isArray(transfer.limitations) ||
    transfer.limitations.length === 0 ||
    !isMapping(transfer.transfer_result)
  ) {
    valid = false;
  }
  for (const [field, nestedReference] of [
    ['environment.representative_assumptions', transfer.environment?.representative_assumptions],
    ['adapter_validation', transfer.adapter_validation],
    ['base_rate_analysis', transfer.base_rate_analysis],
  ]) {
    if (
      !requireTaskReference(
        taskRoot,
        nestedReference,
        `contracts.transfer_evidence.${field}`,
        findings,
      )
    ) {
      valid = false;
    }
  }
  if (
    !verifyTaskDigest(
      taskRoot,
      transfer.transfer_result?.path,
      transfer.transfer_result?.sha256,
      'contracts.transfer_evidence.transfer_result',
      findings,
    )
  ) {
    valid = false;
  }
  if (!valid) {
    addFinding(
      findings,
      'CAPTURE_BINDING_STALE',
      'contracts.transfer_evidence',
      'Transfer evidence does not bind the source level, environment, adapter, base rate, and result',
    );
  }
  return valid;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Top-level lattice computation is intentionally conjunctive.
export async function auditBenchmark(options) {
  if (
    !isMapping(options) ||
    typeof options.repoRoot !== 'string' ||
    typeof options.task !== 'string' ||
    !COMMIT.test(options.commit ?? '')
  ) {
    throw new Error('auditBenchmark requires repoRoot, task, and a full lowercase commit digest');
  }
  const root = canonicalRoot(options.repoRoot);
  const taskAbsolute = resolveInside(root, options.task);
  const taskRelative = path.relative(root, taskAbsolute).split(path.sep).join('/');
  const taskRoot = canonicalRoot(taskAbsolute);
  const findings = [];

  let manifest;
  let manifestSource;
  try {
    manifestSource = readRegularFile(taskRoot, 'benchmark.yml', {
      maxBytes: DEFAULT_LIMITS.maxFileBytes,
    });
    manifest = loadMapping(taskRoot, 'benchmark.yml');
  } catch {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'benchmark.yml',
      'Task manifest is unavailable or invalid',
    );
    const base = auditResult(findings);
    return {
      ...base,
      computedEvidenceLevel: '0',
      trust: { approvals: 'structural-only', claim: 'untrusted', commit: 'caller-supplied' },
    };
  }
  const manifestDigest = hashText(manifestSource);

  if (
    manifest.schema_version !== 1 ||
    !validId(manifest.id) ||
    !MODES.includes(manifest.mode) ||
    !validId(manifest.primary_construct_id) ||
    !isMapping(manifest.owner) ||
    !validId(manifest.owner.author_id) ||
    !isMapping(manifest.implementation) ||
    manifest.implementation.path !== taskRelative ||
    manifest.implementation.commit !== options.commit ||
    !isMapping(manifest.claims) ||
    !isMapping(manifest.evidence) ||
    !validLevel(manifest.evidence.intended_evidence_level) ||
    !(
      manifest.evidence.achieved_evidence_level === null ||
      validLevel(manifest.evidence.achieved_evidence_level)
    )
  ) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'benchmark.yml',
      'Task manifest identity, mode, ownership, path, commit, or evidence level is invalid',
    );
  }

  if (
    (Array.isArray(manifest.executable_checks) && manifest.executable_checks.length > 0) ||
    manifest.command !== undefined ||
    manifest.commands !== undefined ||
    manifest.checks !== undefined
  ) {
    addFinding(
      findings,
      'EXECUTABLE_CHECKS_DISABLED',
      'executable_checks',
      'Executable task checks are disabled in this release',
    );
  }

  const pairing = manifest.pairing;
  if (
    pairing !== null &&
    (!isMapping(pairing) ||
      !validId(pairing.paired_task_id) ||
      !['producer', 'consumer'].includes(pairing.paired_role) ||
      !validId(pairing.pair_contract_version))
  ) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'pairing',
      'Pairing fields must be complete and valid',
    );
  }

  const evidenceReferences = collectEvidenceReferences(manifest, findings);
  const gatesPass = validateGateMatrix(manifest, taskRoot, options.commit, findings);
  const calibrationPass = validateCalibration(manifest, taskRoot, options.commit, findings);
  const referenceCoveragePass = validateReferenceCoverage(manifest, taskRoot, findings);
  const approvalResult = validateApprovals(
    manifest,
    taskRoot,
    options.commit,
    manifestDigest,
    evidenceReferences,
    findings,
  );
  const suiteResult = validateSuite(
    root,
    taskRoot,
    taskRelative,
    manifest,
    options.suite,
    options.commit,
    findings,
  );

  let computedEvidenceLevel = '0';
  const requiredRoles = ['construct-reviewer', 'implementation-reviewer', 'claim-reviewer'];
  let waiversPass = true;
  for (const [gateId, gate] of Object.entries(manifest.gates ?? {})) {
    if (gate?.status !== 'not_applicable') {
      continue;
    }
    const waiver = loadTaskMapping(taskRoot, gate.waiver, `gates.${gateId}.waiver`, findings);
    if (
      !waiver ||
      typeof waiver.approval !== 'string' ||
      !Array.isArray(manifest.approvals) ||
      !manifest.approvals.includes(waiver.approval) ||
      !approvalResult.approvals.has('gate-waiver-reviewer')
    ) {
      addFinding(
        findings,
        'GATE_WAIVER_INVALID',
        `gates.${gateId}.waiver`,
        'Waiver lacks a current gate-waiver approval',
      );
      waiversPass = false;
    }
  }
  const approvalsPass =
    waiversPass && requiredRoles.every((role) => approvalResult.approvals.has(role));
  if (
    gatesPass &&
    calibrationPass &&
    referenceCoveragePass &&
    approvalsPass &&
    suiteResult.reciprocal &&
    suiteResult.valid
  ) {
    computedEvidenceLevel = '1';
  }

  const level2Evidence = isMapping(manifest.evidence) ? manifest.evidence.level2 : null;
  if (computedEvidenceLevel === '1' && typeof level2Evidence === 'string') {
    const level2 = loadTaskMapping(taskRoot, level2Evidence, 'evidence.level2', findings);
    if (
      level2?.enterprise_semantics_reviewed === true &&
      level2?.matched_benign_current === true &&
      level2?.independent_scoring_validation === true &&
      calibrationPass
    ) {
      computedEvidenceLevel = '2';
    }
  }
  const contracts = isMapping(manifest.contracts) ? manifest.contracts : {};
  const has3A =
    computedEvidenceLevel === '2' &&
    typeof contracts.capture_manifest === 'string' &&
    approvalResult.approvals.has('grounding-reviewer') &&
    suiteResult.reciprocal &&
    validateCaptureManifest(manifest, taskRoot, options.commit, findings);
  const has3B =
    computedEvidenceLevel === '2' &&
    typeof contracts.external_grounding === 'string' &&
    approvalResult.approvals.has('grounding-reviewer') &&
    validateExternalGrounding(manifest, taskRoot, findings);
  if (has3A && has3B) {
    computedEvidenceLevel = '3A+3B';
  } else if (has3A) {
    computedEvidenceLevel = '3A';
  } else if (has3B) {
    computedEvidenceLevel = '3B';
  }
  if (
    ['3A', '3B', '3A+3B'].includes(computedEvidenceLevel) &&
    typeof contracts.transfer_evidence === 'string' &&
    approvalResult.approvals.has('transfer-reviewer') &&
    validateTransferEvidence(manifest, taskRoot, computedEvidenceLevel, findings)
  ) {
    computedEvidenceLevel = '4';
  }

  if (
    manifest.evidence?.achieved_evidence_level !== null &&
    manifest.evidence?.achieved_evidence_level !== computedEvidenceLevel
  ) {
    addFinding(
      findings,
      'EVIDENCE_LEVEL_OVERCLAIMED',
      'evidence.achieved_evidence_level',
      'Stored achieved evidence does not equal the auditor-computed level',
    );
  }
  if (
    isMapping(manifest.claims) &&
    validLevel(manifest.claims.claimed_evidence_level) &&
    !levelSupports(computedEvidenceLevel, manifest.claims.claimed_evidence_level)
  ) {
    addFinding(
      findings,
      'EVIDENCE_LEVEL_OVERCLAIMED',
      'claims.claimed_evidence_level',
      'Structured claimed evidence exceeds the computed level',
    );
  }

  const base = auditResult(findings);
  return {
    ...base,
    computedEvidenceLevel,
    trust: {
      approvals: 'structural-only',
      claim: 'untrusted',
      commit: 'caller-supplied',
    },
  };
}

function parseArguments(argv) {
  const options = {};
  const allowed = new Set(['repo_root', 'task', 'commit', 'suite', 'format']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      return { help: true };
    }
    if (!argument.startsWith('--') || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    const key = argument.slice(2).replaceAll('-', '_');
    if (!allowed.has(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function showHelp() {
  process.stdout.write(
    'Usage: audit_benchmark.mjs --repo-root <path> --task <relative-path> --commit <full-hex> [--suite <relative-path>] [--format human|json]\n',
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      showHelp();
      process.exitCode = 0;
    } else {
      const result = await auditBenchmark({
        repoRoot: args.repo_root,
        task: args.task,
        commit: args.commit,
        suite: args.suite,
      });
      printResult(result, args.format ?? 'human');
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
