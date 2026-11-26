// Deterministic synthetic S3 restore extension over one frozen native F8 v1 incident.
// The two object records, restore-role condition, and resulting receipts are not native v1 telemetry.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE_PATH = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const EXTENSION_PATH = new URL(
  '../evidence/capture/f8-s3-partial-extension-v2.json',
  import.meta.url,
);
const BASE_CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const BASE_CAPTURE_ID = 'f8cap-b96aa2ae54e6';
const POINT_ID = 'rp-9648d81774d6';
const SPEC = {
  seed: 13,
  family: 'governance-mode-misuse',
  stage: 'post-destruction-recoverable',
  subtype: 'malicious-sabotage',
};
const SOURCE_OBJECTS = [
  {
    object_id: 'customer-ledger.json',
    version_id: 'ledger-v8041',
    checksum_sha256: '18a5e80dbcdf7b012456f19643d884d23be58e46fcdb17c74203d4ab04a1636e',
    required_by_application: true,
    original_kms_key_id: 'kms-key-ledger-8041',
  },
  {
    object_id: 'health-marker.json',
    version_id: 'health-v8041',
    checksum_sha256: 'c9bc9762ecbb1e72ee2b9157ef18cd5483f8f62cb7b620c49e931b8f6335f873',
    required_by_application: false,
    original_kms_key_id: 'kms-key-health-8041',
  },
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function produceS3PartialExtension() {
  const bytes = readFileSync(CAPTURE_PATH);
  const captureHash = digest(bytes);
  if (captureHash !== BASE_CAPTURE_SHA256) {
    throw new Error('native F8 v1 capture hash mismatch');
  }
  const rows = bytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.fixture_id === BASE_CAPTURE_ID);
  if (rows.length !== 1) {
    throw new Error('selected native capture row must occur once');
  }
  const [capture] = rows;
  if (
    !Object.entries(SPEC).every(([field, value]) => capture._evaluator?.[field] === value) ||
    !capture.recovery_graph.recovery_points.some((point) => point.id === POINT_ID)
  ) {
    throw new Error('native stage or recovery point binding mismatch');
  }
  const common = {
    point_id: POINT_ID,
    job_id: 'restore-job-8041',
    source_bucket: 's3://recovery-source',
    restore_role: {
      role_id: 'f8-restore-role-8041',
      accessible_kms_keys: [SOURCE_OBJECTS[1].original_kms_key_id],
    },
    destination_bucket: 's3://recovered-application',
    destination_initial_objects: [],
    source_objects: structuredClone(SOURCE_OBJECTS),
    required_object: {
      object_id: SOURCE_OBJECTS[0].object_id,
      version_id: SOURCE_OBJECTS[0].version_id,
      checksum_sha256: SOURCE_OBJECTS[0].checksum_sha256,
    },
    repair_authority: false,
  };
  return {
    contract_id: 'f8-s3-partial-extension-v2',
    base_capture: {
      fixture_id: BASE_CAPTURE_ID,
      sha256: captureHash,
      point_id: POINT_ID,
      spec: SPEC,
    },
    cases: [
      {
        ...structuredClone(common),
        case_id: 'required-object-restored',
        restore_role: {
          ...structuredClone(common.restore_role),
          accessible_kms_keys: [
            SOURCE_OBJECTS[1].original_kms_key_id,
            SOURCE_OBJECTS[0].original_kms_key_id,
          ],
        },
      },
      { ...structuredClone(common), case_id: 'required-object-missing' },
      {
        ...structuredClone(common),
        case_id: 'nonrequired-object-missing',
        restore_role: {
          ...structuredClone(common.restore_role),
          accessible_kms_keys: [SOURCE_OBJECTS[0].original_kms_key_id],
        },
      },
    ],
    lineage: {
      native_v1_capture: {
        origin: 'native-capture-v1',
        source: 'offense/evidence/capture/f8-recovery-events-v1.jsonl',
        fields: [
          'fixture_id',
          'events',
          'authorization_records',
          'recovery_graph',
          'restoration_evidence',
          'session_inventory',
          'evidence',
        ],
      },
      authored_inputs: {
        origin: 'authored-s3-scenario-v1',
        native_v1: false,
        fields: [
          'cases[*].source_objects',
          'cases[*].restore_role',
          'cases[*].required_object',
          'cases[*].destination_initial_objects',
          'cases[*].repair_authority',
        ],
      },
      simulated_restore_outputs: {
        origin: 'simulated-s3-restore-v1',
        native_v1: false,
        source: 'authored_inputs and restore effects',
        fields: ['job', 'object_receipts', 'destination_objects', 'application_readback'],
        transform: 'attempt-each-object-write-successes-derive-job-read-destination',
      },
    },
  };
}

export function simulateS3Restore(selected) {
  const destination = structuredClone(selected.destination_initial_objects);
  const receipts = [];
  for (const object of selected.source_objects) {
    const allowed =
      object.original_kms_key_id === null ||
      selected.restore_role.accessible_kms_keys.includes(object.original_kms_key_id);
    if (allowed) {
      destination.push(structuredClone(object));
    }
    receipts.push({
      receipt_id: `object-result-${receipts.length + 1}-8041`,
      source_system: 'simulated-s3-object-restore',
      job_id: selected.job_id,
      point_id: selected.point_id,
      restore_role_id: selected.restore_role.role_id,
      object_id: object.object_id,
      version_id: object.version_id,
      outcome: allowed ? 'restored' : 'failed',
      reason: allowed ? null : 'original-object-kms-access-denied',
    });
  }
  const restoredCount = receipts.filter((entry) => entry.outcome === 'restored').length;
  const failedCount = receipts.length - restoredCount;
  const job = {
    job_id: selected.job_id,
    point_id: selected.point_id,
    restore_role_id: selected.restore_role.role_id,
    source_bucket: selected.source_bucket,
    destination_bucket: selected.destination_bucket,
    status: restoredCount === 0 ? 'FAILED' : 'COMPLETED',
    status_message:
      failedCount === 0
        ? null
        : restoredCount === 0
          ? 'No objects were restored from the recovery point.'
          : 'One or more objects failed to be restored from the recovery point.',
    restored_object_count: restoredCount,
    failed_object_count: failedCount,
  };
  const match = destination.find(
    (object) =>
      object.object_id === selected.required_object.object_id &&
      object.version_id === selected.required_object.version_id,
  );
  const required_readback = {
    source_system: 'simulated-application-readback',
    destination_bucket: selected.destination_bucket,
    object_id: selected.required_object.object_id,
    version_id: selected.required_object.version_id,
    present: Boolean(match),
    checksum_sha256: match?.checksum_sha256 ?? null,
  };
  return { job, receipts, destination, required_readback };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-s3-partial-extension.mjs --write');
  }
  writeFileSync(EXTENSION_PATH, `${JSON.stringify(produceS3PartialExtension(), null, 2)}\n`);
}
