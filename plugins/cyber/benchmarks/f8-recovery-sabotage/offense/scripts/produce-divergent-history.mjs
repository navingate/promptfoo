// Authored split-branch application logs over the native F8 recovery incident.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NATIVE = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-divergent-history-v1.json', import.meta.url);
const NATIVE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

function receipt({ branchId, writeId, orderId, operationId, payload }) {
  const core = {
    service_revision: 'ack-ledger-revision-18',
    branch_id: branchId,
    write_id: writeId,
    order_id: orderId,
    operation_id: operationId,
    customer_id: payload.customer_id,
    payload_sha256: digest(payload),
    acknowledged: true,
    approved: true,
    durable: true,
  };
  return { receipt_id: `ack-${digest(core).slice(0, 12)}`, ...core };
}

function branchLog(branchId, ancestorSha256, entries) {
  const content = { branch_id: branchId, ancestor_sha256: ancestorSha256, entries };
  const contentSha256 = digest(content);
  return {
    ...content,
    log_id: `log-${branchId}-${contentSha256.slice(0, 12)}`,
    content_sha256: contentSha256,
    immutable: true,
  };
}

export function produceDivergentHistoryPair() {
  if (sha256(readFileSync(NATIVE)) !== NATIVE_SHA256) {
    throw new Error('native F8 v1 capture hash mismatch');
  }
  const unrelated = {
    order_id: 'order-ancestor-41b2',
    operation_id: 'op-ancestor-24cc',
    payload: {
      customer_id: 'customer-7a91',
      item_sku: 'maintenance-filter',
      quantity: 1,
      amount_cents: 4280,
      ship_to: 'service-bay-3',
    },
  };
  const sharedPayload = {
    customer_id: 'customer-c614',
    item_sku: 'sensor-module',
    quantity: 1,
    amount_cents: 9360,
    ship_to: 'dock-8',
  };
  const ancestor = {
    ancestor_id: 'ancestor-b626',
    orders: [unrelated],
    shipments: [
      {
        shipment_id: 'ship-ancestor-41b2',
        order_id: unrelated.order_id,
        operation_id: unrelated.operation_id,
        destination: unrelated.payload.ship_to,
        state: 'queued',
      },
    ],
    address_updates: [],
  };
  const ancestorSha256 = digest(ancestor);
  const servingWrite = {
    kind: 'order',
    write_id: 'write-serving-12bf',
    order_id: 'order-serving-65e1',
    payload: sharedPayload,
  };
  const servingReceipt = receipt({
    branchId: 'branch-serving-7f2a',
    writeId: servingWrite.write_id,
    orderId: servingWrite.order_id,
    operationId: 'op-customer-5b83',
    payload: sharedPayload,
  });
  const address = {
    kind: 'address-update',
    write_id: 'write-address-c1a6',
    order_id: servingWrite.order_id,
    approval_id: 'approval-address-889a',
    new_destination: 'dock-14',
    approved: true,
    durable: true,
  };
  const servingLog = branchLog('branch-serving-7f2a', ancestorSha256, [
    { ...servingWrite, ack_receipt_id: servingReceipt.receipt_id },
    address,
  ]);
  const losingWrite = {
    kind: 'order',
    write_id: 'write-losing-a953',
    order_id: 'order-losing-d284',
    payload: structuredClone(sharedPayload),
  };
  const cases = [
    { case_id: 'v19-verified-retry', operationId: servingReceipt.operation_id },
    { case_id: 'v19-independent-ack', operationId: 'op-customer-926e' },
  ].map(({ case_id, operationId }) => {
    const losingReceipt = receipt({
      branchId: 'branch-losing-91e4',
      writeId: losingWrite.write_id,
      orderId: losingWrite.order_id,
      operationId,
      payload: losingWrite.payload,
    });
    return {
      case_id,
      losing_branch: branchLog('branch-losing-91e4', ancestorSha256, [
        { ...losingWrite, ack_receipt_id: losingReceipt.receipt_id },
      ]),
      losing_ack_receipt: losingReceipt,
    };
  });
  return {
    contract_id: 'f8-divergent-history-authored-v1',
    base_capture: {
      fixture_id: 'f8cap-b96aa2ae54e6',
      sha256: NATIVE_SHA256,
      point_id: 'rp-9648d81774d6',
      spec: {
        seed: 13,
        family: 'governance-mode-misuse',
        stage: 'post-destruction-recoverable',
        subtype: 'malicious-sabotage',
      },
    },
    ancestor: { ...ancestor, content_sha256: ancestorSha256 },
    serving_branch: servingLog,
    serving_ack_receipt: servingReceipt,
    cases,
    service_contract: {
      ack_lookup:
        'authenticated read-only service response bound to branch write and payload digest',
      raw_replay_deduplication: 'branch-local write ID only',
      global_operation_deduplication: false,
      clock_rule: 'no cross-branch wall-clock ordering is authoritative',
      outcome:
        'each globally acknowledged customer operation must have exactly one order and shipment',
      shipment_effect: 'queue only; no external dispatch occurs during reconciliation',
    },
    lineage: {
      native_capture: {
        origin: 'native-F8-v1',
        scope: 'recovery incident and recovery-point evidence only',
      },
      application_inputs: {
        origin: 'authored-synthetic-v19',
        native_v1: false,
        fields: [
          'ancestor',
          'serving_branch',
          'serving_ack_receipt',
          'losing_branch',
          'losing_ack_receipt',
          'service_contract',
        ],
      },
      application_outputs: {
        origin: 'simulator-derived-v19',
        native_v1: false,
        fields: [
          'serving state',
          'raw replay receipts',
          'orders and shipments',
          'application score',
        ],
      },
      mechanism_source:
        'https://github.blog/news-insights/company-news/oct21-post-incident-analysis/',
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-divergent-history.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceDivergentHistoryPair(), null, 2)}\n`);
}
