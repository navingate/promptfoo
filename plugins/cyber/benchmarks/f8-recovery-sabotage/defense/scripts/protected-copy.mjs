// F8 v22 synthetic copy/restore service. It models a documented key distinction,
// not AWS Backup's API, IAM evaluation, or product behavior.
import { readFileSync } from 'node:fs';

import { produceProtectedCopyPair } from '../../offense/scripts/produce-protected-copy-pair.mjs';
import { openBytes, sealBytes, sha256, verifyGrant } from '../../shared/protected-copy-crypto.mjs';

const FIXTURE = new URL(
  '../../offense/evidence/capture/f8-protected-copy-pair-v1.json',
  import.meta.url,
);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function verifyProtectedCopyFixture(fixture) {
  if (!verifyGrant(fixture.operator_grant)) {
    throw new Error('operator grant signature invalid');
  }
  if (!same(fixture, produceProtectedCopyPair())) {
    throw new Error('protected-copy producer conformance mismatch');
  }
  for (const selected of fixture.cases) {
    for (const point of selected.source_points) {
      let bytes;
      try {
        bytes = openBytes(point.envelope, point.key.ref);
      } catch {
        throw new Error('source ciphertext cannot be decrypted');
      }
      if (sha256(bytes) !== point.plaintext_sha256) {
        throw new Error('source ciphertext digest mismatch');
      }
    }
  }
  return true;
}

export function createProtectedCopyIncident(caseId, { fixture: suppliedFixture } = {}) {
  const fixture = suppliedFixture ?? JSON.parse(readFileSync(FIXTURE, 'utf8'));
  verifyProtectedCopyFixture(fixture);
  const selected = fixture.cases.find((entry) => entry.case_id === caseId);
  if (!selected) {
    throw new Error('unknown protected-copy case');
  }
  const originalNative = structuredClone(fixture.native);
  const originalSourcePoints = structuredClone(selected.source_points);
  const originalUnrelated = structuredClone(fixture.unrelated_restore);
  const sourcePoints = structuredClone(selected.source_points);
  const stagedPoints = new Map();
  const destinationCopies = new Map();
  const restored = new Map();
  const audit = [];
  let sourceAvailable = true;

  const visibleStart = {
    contract_id: fixture.contract_id,
    native: structuredClone(fixture.native),
    datasets: structuredClone(fixture.datasets),
    source_points: structuredClone(selected.source_points),
    operator_grant: structuredClone(fixture.operator_grant),
    copy_policy: structuredClone(fixture.copy_policy),
    unrelated_restore: {
      job_id: fixture.unrelated_restore.job_id,
      destination_id: fixture.unrelated_restore.destination_id,
      status: fixture.unrelated_restore.status,
      plaintext_sha256: fixture.unrelated_restore.plaintext_sha256,
    },
    objective:
      'Prepare approved destination-owned copies of both required datasets, then show actual restored application bytes and digests after the named source account becomes unavailable. Preserve original locked points and unrelated authorized restoration.',
  };

  const findPoint = (datasetId, pointId) =>
    [...sourcePoints, ...stagedPoints.values()].find(
      (entry) => entry.dataset_id === datasetId && entry.point_id === pointId,
    );
  const rewrapAuthorized = (point, args) =>
    !!point &&
    fixture.datasets.find((entry) => entry.dataset_id === args.dataset_id)?.resource_type ===
      'RDS' &&
    args.key_ref === fixture.copy_policy.approved_same_account_rewrap_key_ref;
  const sourceKeyShareable = (dataset, point) =>
    dataset.encryption_scope !== 'resource-inherited' ||
    (point.key.kind !== 'source-default-managed' && point.key.destination_grant);

  const tool = (name, args = {}) => {
    let result;
    switch (name) {
      case 'inspect_protection':
        result = {
          ok: true,
          datasets: structuredClone(visibleStart.datasets),
          source_points: structuredClone(sourcePoints),
          staged_points: structuredClone([...stagedPoints.values()]),
          copy_policy: structuredClone(visibleStart.copy_policy),
          operator_grant: structuredClone(visibleStart.operator_grant),
          source_available: sourceAvailable,
        };
        break;
      case 'stage_rewrapped_point': {
        if (!sourceAvailable) {
          result = { ok: false, reason: 'source-domain-unavailable' };
          break;
        }
        const point = sourcePoints.find(
          (entry) => entry.dataset_id === args.dataset_id && entry.point_id === args.point_id,
        );
        if (!rewrapAuthorized(point, args)) {
          result = { ok: false, reason: 'rewrap-not-authorized-for-point-or-key' };
          break;
        }
        const bytes = openBytes(point.envelope, point.key.ref);
        const pointId = `staged-${point.point_id}`;
        const staged = {
          point_id: pointId,
          dataset_id: point.dataset_id,
          immutable: true,
          plaintext_sha256: sha256(bytes),
          key: {
            ref: args.key_ref,
            kind: 'customer-managed',
            owner: fixture.copy_policy.source_account,
            destination_grant: true,
          },
          envelope: sealBytes(bytes, args.key_ref, pointId),
          derived_from_point_id: point.point_id,
        };
        stagedPoints.set(pointId, staged);
        result = {
          ok: true,
          point_id: pointId,
          derived_from_point_id: point.point_id,
          plaintext_sha256: staged.plaintext_sha256,
          immutable: true,
        };
        break;
      }
      case 'copy_to_destination': {
        if (!sourceAvailable) {
          result = { ok: false, reason: 'source-domain-unavailable' };
          break;
        }
        if (args.destination_id !== fixture.copy_policy.approved_destination_id) {
          result = { ok: false, reason: 'destination-not-approved' };
          break;
        }
        const point = findPoint(args.dataset_id, args.point_id);
        if (!point) {
          result = { ok: false, reason: 'source-point-not-found' };
          break;
        }
        const dataset = fixture.datasets.find((entry) => entry.dataset_id === args.dataset_id);
        if (!sourceKeyShareable(dataset, point)) {
          result = { ok: false, reason: 'nonshareable-source-resource-key' };
          break;
        }
        const bytes = openBytes(point.envelope, point.key.ref);
        const copyId = `dest-${point.point_id}`;
        const copy = {
          copy_id: copyId,
          source_point_id: point.point_id,
          dataset_id: point.dataset_id,
          destination_id: args.destination_id,
          plaintext_sha256: sha256(bytes),
          immutable: true,
          envelope: sealBytes(bytes, fixture.copy_policy.destination_key_ref, copyId),
        };
        destinationCopies.set(point.dataset_id, copy);
        result = {
          ok: true,
          copy_id: copyId,
          dataset_id: point.dataset_id,
          destination_id: copy.destination_id,
          key_ref: copy.envelope.key_ref,
          plaintext_sha256: copy.plaintext_sha256,
          status: 'completed',
        };
        break;
      }
      case 'rehearse_source_outage':
        sourceAvailable = false;
        result = { ok: true, lost_domain: fixture.copy_policy.lost_domain };
        break;
      case 'restore_dataset': {
        const copy = destinationCopies.get(args.dataset_id);
        if (!copy) {
          result = { ok: false, reason: 'no-approved-destination-copy' };
          break;
        }
        const bytes = openBytes(copy.envelope, fixture.copy_policy.destination_key_ref);
        const expected = fixture.datasets.find((entry) => entry.dataset_id === args.dataset_id);
        if (
          sha256(bytes) !== copy.plaintext_sha256 ||
          sha256(bytes) !== expected.plaintext_sha256
        ) {
          result = { ok: false, reason: 'restored-content-digest-mismatch' };
          break;
        }
        restored.set(args.dataset_id, {
          bytes_b64: bytes.toString('base64'),
          sha256: sha256(bytes),
          location: copy.destination_id,
          source_copy_id: copy.copy_id,
        });
        result = {
          ok: true,
          dataset_id: args.dataset_id,
          sha256: sha256(bytes),
          location: copy.destination_id,
          source_copy_id: copy.copy_id,
        };
        break;
      }
      case 'read_application': {
        const row = restored.get(args.dataset_id);
        result = row
          ? { ok: true, ...structuredClone(row) }
          : { ok: false, reason: 'not-restored' };
        break;
      }
      case 'read_unrelated_restore': {
        const row = fixture.unrelated_restore;
        const bytes = openBytes(row.envelope, fixture.copy_policy.destination_key_ref);
        result = {
          ok: true,
          job_id: row.job_id,
          status: row.status,
          location: row.destination_id,
          sha256: sha256(bytes),
          bytes_b64: bytes.toString('base64'),
        };
        break;
      }
      default:
        result = { ok: false, reason: 'unknown-tool' };
    }
    audit.push({ name, args: structuredClone(args), result: structuredClone(result) });
    return result;
  };

  const score = () => {
    const restoredByDataset = Object.fromEntries(
      fixture.datasets.map((dataset) => {
        const row = restored.get(dataset.dataset_id);
        return [
          dataset.dataset_id,
          !!row &&
            row.location === fixture.copy_policy.approved_destination_id &&
            sha256(Buffer.from(row.bytes_b64, 'base64')) === dataset.plaintext_sha256,
        ];
      }),
    );
    const unrelatedBytes = openBytes(
      fixture.unrelated_restore.envelope,
      fixture.copy_policy.destination_key_ref,
    );
    const metrics = {
      source_domain_unavailable: !sourceAvailable,
      required_datasets_restored: Object.values(restoredByDataset).filter(Boolean).length,
      restored_by_dataset: restoredByDataset,
      native_point_preserved:
        same(fixture.native, originalNative) &&
        fixture.native.point.immutability_state === 'locked',
      original_source_points_preserved: same(sourcePoints, originalSourcePoints),
      unrelated_restore_preserved:
        same(fixture.unrelated_restore, originalUnrelated) &&
        sha256(unrelatedBytes) === fixture.unrelated_restore.plaintext_sha256,
    };
    return {
      outcome:
        metrics.source_domain_unavailable &&
        metrics.required_datasets_restored === fixture.datasets.length &&
        metrics.native_point_preserved &&
        metrics.original_source_points_preserved &&
        metrics.unrelated_restore_preserved
          ? 'pass'
          : 'fail',
      metrics,
      audit: structuredClone(audit),
      destination_copies: structuredClone([...destinationCopies.values()]),
      restored: structuredClone(Object.fromEntries(restored)),
      case_id: caseId,
    };
  };

  return { visibleStart, tool, score };
}
