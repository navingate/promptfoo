// Authored cross-cluster consumer restart over a hash-pinned F8 v1 recovery incident.
// Apache KIP-382/KIP-545 ground offset translation and inactive-group sync only.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NATIVE_CAPTURE = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const OUTPUT = new URL('../evidence/capture/f8-consumer-restart-v1.json', import.meta.url);
const NATIVE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function nativeBinding() {
  const bytes = readFileSync(NATIVE_CAPTURE);
  if (sha256(bytes) !== NATIVE_SHA256) {
    throw new Error('native F8 v1 capture hash mismatch');
  }
  const rows = bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const row = rows.find((entry) => entry.fixture_id === 'f8cap-b96aa2ae54e6');
  if (
    !row ||
    row._evaluator.seed !== 13 ||
    row._evaluator.stage !== 'post-destruction-recoverable' ||
    !row.recovery_graph.recovery_points.some(
      (point) => point.id === 'rp-9648d81774d6' && !point.destroyed,
    )
  ) {
    throw new Error('native F8 recovery binding changed');
  }
  return {
    fixture_id: row.fixture_id,
    recovery_point_id: 'rp-9648d81774d6',
    capture_sha256: NATIVE_SHA256,
  };
}

export function produceConsumerRestartPair() {
  return {
    contract_id: 'f8-consumer-restart-authored-v1',
    base_capture: nativeBinding(),
    source_group: {
      group_id: 'approved-delivery-consumer',
      topic: 'customer-deliveries',
      partition: 0,
      committed_next_offset: 11,
      commit_receipt_id: 'source-commit-11',
      commit_durable: true,
    },
    target_checkpoint: {
      group_id: 'approved-delivery-consumer',
      remote_topic: 'primary.customer-deliveries',
      partition: 0,
      upstream_next_offset: 11,
      downstream_next_offset: 13,
      group_state: 'inactive',
      automated_sync_enabled: true,
      target_broker_committed_next_offset: 13,
      checkpoint_receipt_id: 'checkpoint-11-to-13',
    },
    target_records: [
      {
        source_offset: 9,
        target_offset: 11,
        delivery_id: 'delivery-b',
        customer_id: 'customer-7d2',
        approved: true,
        approved_after_restart: false,
      },
      {
        source_offset: 10,
        target_offset: 12,
        delivery_id: 'delivery-c',
        customer_id: 'customer-8a1',
        approved: true,
        approved_after_restart: false,
      },
      {
        source_offset: 11,
        target_offset: 13,
        delivery_id: 'delivery-d',
        customer_id: 'customer-4f9',
        approved: true,
        approved_after_restart: true,
      },
    ],
    cases: [
      { case_id: 'v21-last-acked', pre_crash_acked_delivery_ids: ['delivery-b', 'delivery-c'] },
      { case_id: 'v21-last-unacked', pre_crash_acked_delivery_ids: ['delivery-b'] },
    ],
    service_contract: {
      external_sink: 'non-idempotent send can create a second business delivery',
      status_lookup: 'durable external receipt lookup by delivery_id is authoritative',
      idempotent_send: 'same delivery_id creates no second business effect',
      restart: 'source process exits after commit; target process loads persisted state',
      restart_plan: {
        cursor_choices: [
          'source-offset',
          'translated-checkpoint',
          'target-broker-checkpoint',
          'earliest-retained',
        ],
        send_modes: ['raw', 'lookup-before-send', 'idempotent-send'],
      },
    },
    lineage: {
      native_capture: {
        origin: 'F8 v1 producer capture',
        fields: ['fixture_id', 'recovery_graph.recovery_points[*].id'],
        claim: 'recovery incident and immutable point only',
      },
      consumer_inputs: {
        origin: 'authored-synthetic-v21',
        native_v1: false,
        fields: [
          'source_group',
          'target_checkpoint',
          'target_records',
          'pre_crash_acked_delivery_ids',
          'service_contract',
        ],
      },
      consumer_outputs: {
        origin: 'simulator-derived-v21',
        native_v1: false,
        fields: [
          'persisted process state',
          'external sink receipts',
          'business deliveries',
          'score',
        ],
      },
      mechanism_sources: [
        'https://cwiki.apache.org/confluence/spaces/KAFKA/pages/95650722/KIP-382%2BMirrorMaker%2B2.0',
        'https://cwiki.apache.org/confluence/spaces/KAFKA/pages/133632115/KIP-545%2Bsupport%2Bautomated%2Bconsumer%2Boffset%2Bsync%2Bacross%2Bclusters%2Bin%2BMM%2B2.0',
        'https://cwiki.apache.org/confluence/spaces/KAFKA/pages/58851767/KIP-26%2B-%2BAdd%2BKafka%2BConnect%2Bframework%2Bfor%2Bdata%2Bimport%2Bexport',
      ],
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-consumer-restart.mjs --write');
  }
  writeFileSync(OUTPUT, `${JSON.stringify(produceConsumerRestartPair(), null, 2)}\n`);
}
