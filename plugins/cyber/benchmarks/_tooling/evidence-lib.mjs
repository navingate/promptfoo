// Shared evidence-generation helpers for the cyber benchmark families.
//
// Build-time only (not part of any estate runtime). Imported by each task's
// scripts/generate-evidence.mjs and scripts/build-manifest.mjs entry points, so
// knip reaches it. Deterministic: given the same artifacts it emits byte-identical
// YAML/JSON. Uses js-yaml (a repo dependency) for manifest/evidence serialization.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import * as yaml from 'js-yaml';

// Mirrors audit_telemetry_contract.mjs SOURCE_GROUPS (order matters for the digest).
export const SOURCE_GROUPS = Object.freeze([
  'prompts',
  'files',
  'telemetry',
  'tool_descriptions',
  'feedback',
  'artifacts',
  'serialized_results',
]);

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function sha256File(absolutePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

export function ensureDir(absoluteDir) {
  fs.mkdirSync(absoluteDir, { recursive: true });
}

export function writeText(absolutePath, text) {
  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, text);
  return text;
}

export function writeJson(absolutePath, value) {
  return writeText(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonl(absolutePath, rows) {
  return writeText(absolutePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

export function writeYaml(absolutePath, value) {
  return writeText(
    absolutePath,
    yaml.dump(value, { noRefs: true, sortKeys: false, lineWidth: 100 }),
  );
}

export function readYaml(absolutePath) {
  return yaml.load(fs.readFileSync(absolutePath, 'utf8'), { schema: yaml.JSON_SCHEMA });
}

/**
 * Exact replica of audit_telemetry_contract.mjs computeStagedContextDigest.
 * `sources` entries: { group, path, sha256, schema? }. `environments` entries:
 * { group:'environment', name, classification, value_sha256 }.
 */
export function stagedContextDigest(sources, environments) {
  const canonical = Object.fromEntries(
    [...SOURCE_GROUPS, 'environment'].map((group) => {
      if (group === 'environment') {
        return [group, [...environments].sort((a, b) => a.name.localeCompare(b.name))];
      }
      return [
        group,
        sources
          .filter((entry) => entry.group === group)
          .map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            schema: entry.schema ?? null,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      ];
    }),
  );
  return sha256Text(JSON.stringify(canonical));
}

/** Build a task-relative artifact reference { path, sha256 } for a file on disk. */
export function artifactRef(taskDir, relativePath) {
  return { path: relativePath, sha256: sha256File(path.join(taskDir, relativePath)) };
}

/** Gate evidence document per references/schemas.md. */
export function gateEvidenceDoc({ gate, taskId, commit, checks, artifacts }) {
  return {
    schema_version: 1,
    gate,
    task_id: taskId,
    commit,
    checks,
    artifacts,
  };
}

/** A recorded reviewer decision in the approval schema (references/schemas.md). */
export function approvalDoc({
  approvalId,
  taskId,
  role,
  reviewerId,
  authorId,
  relationship,
  reviewedCommit,
  manifestSha256,
  evidenceSha256,
  claimTextSha256,
  approvedEvidenceLevel,
  reviewedAt,
  note,
}) {
  return {
    schema_version: 1,
    approval_id: approvalId,
    task_id: taskId,
    role,
    reviewer_id: reviewerId,
    author_id: authorId,
    relationship,
    independent: true,
    reviewed_commit: reviewedCommit,
    manifest_sha256: manifestSha256,
    evidence_sha256: evidenceSha256,
    claim_text_sha256: claimTextSha256,
    decision: 'approved',
    approved_evidence_level: approvedEvidenceLevel,
    reviewed_at: reviewedAt,
    ...(note ? { note } : {}),
  };
}
