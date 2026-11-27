// F8 v22 authored key/copy rehearsal over one frozen native recovery incident.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sealBytes, sha256, signGrant } from '../../shared/protected-copy-crypto.mjs';

const CAPTURE = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const OUTPUT = new URL('../evidence/capture/f8-protected-copy-pair-v1.json', import.meta.url);
const CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const CAPTURE_ID = 'f8cap-b96aa2ae54e6';
const NATIVE_POINT_ID = 'rp-9648d81774d6';
const DESTINATION_ID = 'recovery-account-vault';
const DESTINATION_KEY = 'cmk-recovery-vault';

const dataBytes = {
  'customer-objects': Buffer.from(
    JSON.stringify({ tenant: 'northstar', object: 'invoice-742', version: 3, amount_cents: 18420 }),
  ),
  'customer-ledger': Buffer.from(
    JSON.stringify({ tenant: 'northstar', acknowledged_entry: 'ledger-742', balance_cents: 18420 }),
  ),
};

function nativeContext() {
  const bytes = readFileSync(CAPTURE);
  if (sha256(bytes) !== CAPTURE_SHA256) {
    throw new Error('frozen F8 v1 capture hash mismatch');
  }
  const matching = bytes
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.fixture_id === CAPTURE_ID);
  if (matching.length !== 1) {
    throw new Error('native F8 recovery incident is not unique');
  }
  const row = matching[0];
  const point = row.recovery_graph.recovery_points.find((entry) => entry.id === NATIVE_POINT_ID);
  if (!point || point.immutability_state !== 'locked' || point.destroyed) {
    throw new Error('native F8 immutable point unavailable');
  }
  return {
    fixture_id: CAPTURE_ID,
    point: structuredClone(point),
    recovery_graph: structuredClone(row.recovery_graph),
  };
}

function sourcePoint(datasetId, key) {
  const pointId = `source-point-${datasetId}`;
  return {
    point_id: pointId,
    dataset_id: datasetId,
    immutable: true,
    plaintext_sha256: sha256(dataBytes[datasetId]),
    key,
    envelope: sealBytes(dataBytes[datasetId], key.ref, pointId),
  };
}

export function produceProtectedCopyPair() {
  const native = nativeContext();
  const objectsPoint = sourcePoint('customer-objects', {
    ref: 'aws-backup-vault-source',
    kind: 'backup-vault-managed',
    owner: 'source-account',
    destination_grant: true,
  });
  const cases = [
    {
      case_id: 'v22-shareable-rds',
      rdsKeyKind: 'customer-managed',
      rdsKeyRef: 'cmk-source-ledger',
    },
    {
      case_id: 'v22-managed-rds',
      rdsKeyKind: 'source-default-managed',
      rdsKeyRef: 'aws-rds-source',
    },
  ].map(({ case_id, rdsKeyKind, rdsKeyRef }) => ({
    case_id,
    source_points: [
      structuredClone(objectsPoint),
      sourcePoint('customer-ledger', {
        ref: rdsKeyRef,
        kind: rdsKeyKind,
        owner: 'source-account',
        destination_grant: rdsKeyKind === 'customer-managed',
      }),
    ],
  }));
  const operatorGrant = signGrant({
    receipt_id: 'operator-grant-v22',
    operator_id: 'recovery-operator-17',
    source_account: 'source-account',
    destination_id: DESTINATION_ID,
    allowed_dataset_ids: ['customer-objects', 'customer-ledger'],
    allowed_actions: ['copy', 'same-account-rewrap', 'restore-rehearsal'],
    status: 'approved',
  });
  const unrelatedBytes = Buffer.from('approved reporting restore remains available');
  return {
    contract_id: 'f8-protected-copy-authored-v1',
    native,
    datasets: [
      {
        dataset_id: 'customer-objects',
        resource_type: 'S3',
        encryption_scope: 'independent-vault',
        plaintext_sha256: sha256(dataBytes['customer-objects']),
        required: true,
      },
      {
        dataset_id: 'customer-ledger',
        resource_type: 'RDS',
        encryption_scope: 'resource-inherited',
        plaintext_sha256: sha256(dataBytes['customer-ledger']),
        required: true,
      },
    ],
    operator_grant: operatorGrant,
    copy_policy: {
      source_account: 'source-account',
      lost_domain: 'source-account',
      approved_destination_id: DESTINATION_ID,
      destination_key_ref: DESTINATION_KEY,
      approved_same_account_rewrap_key_ref: 'cmk-source-rewrap',
      source_rewrap_requires_live_source: true,
      destination_copy_requires_shareable_source_key_for_resource_inherited_backup: true,
      restore_requires_destination_copy_after_source_loss: true,
    },
    unrelated_restore: {
      job_id: 'approved-reporting-restore',
      destination_id: DESTINATION_ID,
      status: 'approved-and-restored',
      plaintext_sha256: sha256(unrelatedBytes),
      envelope: sealBytes(unrelatedBytes, DESTINATION_KEY, 'unrelated-reporting-restore'),
    },
    cases,
    lineage: {
      native_capture_sha256: CAPTURE_SHA256,
      native_fields: [
        'fixture_id',
        'recovery_graph.recovery_points',
        'recovery_graph.dependencies',
      ],
      authored_inputs: [
        'datasets and plaintext bytes',
        'source-point ciphertext and key ownership',
        'operator grant and approved destination',
        'unrelated restore control',
        'source-domain outage rehearsal',
      ],
      simulator_outputs: ['copy receipts', 'destination ciphertext', 'restored bytes and readback'],
      mechanism_sources: [
        'https://docs.aws.amazon.com/aws-backup/latest/devguide/encryption.html',
        'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/share-encrypted-snapshot.html',
      ],
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-protected-copy-pair.mjs --write');
  }
  writeFileSync(OUTPUT, `${JSON.stringify(produceProtectedCopyPair(), null, 2)}\n`);
}
