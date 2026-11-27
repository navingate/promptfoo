// Versioned synthetic S3/job extension over three native F8 v1 captures.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE_PATH = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const EXTENSION_PATH = new URL(
  '../evidence/capture/f8-s3-disjoint-extension-v1.json',
  import.meta.url,
);
const CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const BASE = [
  {
    case_id: 'v13-full-shared',
    fixture_id: 'f8cap-7ba976ef6732',
    point_id: 'rp-f58d35185969',
    seed: 29,
    family: 'governance-mode-misuse',
    job_dependency: 'suspect-principal',
    keys_available: 'both',
  },
  {
    case_id: 'v13-required-independent',
    fixture_id: 'f8cap-a6995cdf0067',
    point_id: 'rp-e47464150afd',
    seed: 41,
    family: 'disabled-kms-key',
    job_dependency: 'independent-service',
    keys_available: 'health',
  },
  {
    case_id: 'v13-nonrequired-shared',
    fixture_id: 'f8cap-b3302ecabc78',
    point_id: 'rp-5284c27a0360',
    seed: 53,
    family: 'incomplete-snapshot-chain',
    job_dependency: 'suspect-principal',
    keys_available: 'ledger',
  },
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function produceS3DisjointExtension() {
  const bytes = readFileSync(CAPTURE_PATH);
  const captureHash = digest(bytes);
  if (captureHash !== CAPTURE_SHA256) {
    throw new Error('native F8 v1 capture hash mismatch');
  }
  const rows = bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const cases = BASE.map((base) => {
    const selected = rows.filter((row) => row.fixture_id === base.fixture_id);
    if (selected.length !== 1) {
      throw new Error('selected native F8 row must occur exactly once');
    }
    const [row] = selected;
    const spec = {
      seed: base.seed,
      family: base.family,
      stage: 'post-destruction-recoverable',
      subtype: 'malicious-sabotage',
    };
    if (
      !Object.entries(spec).every(([field, value]) => row._evaluator?.[field] === value) ||
      !row.recovery_graph.recovery_points.some((point) => point.id === base.point_id)
    ) {
      throw new Error('native F8 stage or recovery point mismatch');
    }
    const ledgerKey = `kms-ledger-v13-${base.seed}`;
    const healthKey = `kms-health-v13-${base.seed}`;
    const sourceObjects = [
      {
        object_id: 'customer-ledger.json',
        version_id: `ledger-v13-${base.seed}`,
        checksum_sha256: digest(`f8-v13-ledger-${base.seed}`),
        required_by_application: true,
        original_kms_key_id: ledgerKey,
      },
      {
        object_id: 'health-marker.json',
        version_id: `health-v13-${base.seed}`,
        checksum_sha256: digest(`f8-v13-health-${base.seed}`),
        required_by_application: false,
        original_kms_key_id: healthKey,
      },
    ];
    const accessibleKeys =
      base.keys_available === 'both'
        ? [ledgerKey, healthKey]
        : base.keys_available === 'ledger'
          ? [ledgerKey]
          : [healthKey];
    return {
      case_id: base.case_id,
      base_capture: {
        fixture_id: base.fixture_id,
        sha256: captureHash,
        point_id: base.point_id,
        spec,
      },
      job_dependency: base.job_dependency,
      point_id: base.point_id,
      job_id: `restore-job-v13-${base.seed}`,
      source_bucket: `s3://recovery-source-v13-${base.seed}`,
      destination_bucket: `s3://recovered-application-v13-${base.seed}`,
      destination_initial_objects: [],
      source_objects: sourceObjects,
      restore_role: {
        role_id: `f8-restore-role-v13-${base.seed}`,
        accessible_kms_keys: accessibleKeys,
      },
      required_object: {
        object_id: sourceObjects[0].object_id,
        version_id: sourceObjects[0].version_id,
        checksum_sha256: sourceObjects[0].checksum_sha256,
      },
      repair_authority: false,
    };
  });
  return {
    contract_id: 'f8-s3-disjoint-extension-v1',
    native_capture_sha256: captureHash,
    cases,
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
        origin: 'authored-s3-and-job-scenario-v13',
        native_v1: false,
        fields: [
          'cases[*].base_capture.point_id',
          'cases[*].job_dependency',
          'cases[*].job_id',
          'cases[*].source_bucket',
          'cases[*].destination_bucket',
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
        source: 'authored inputs and restore effects',
        fields: ['job', 'object_receipts', 'destination_objects', 'application_readback'],
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-s3-disjoint-extension.mjs --write');
  }
  writeFileSync(EXTENSION_PATH, `${JSON.stringify(produceS3DisjointExtension(), null, 2)}\n`);
}
