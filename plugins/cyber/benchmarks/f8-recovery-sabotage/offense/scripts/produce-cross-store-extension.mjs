// F8 v16 application records are authored. Only the selected incident and recovery point are native v1.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-cross-store-extension-v1.json', import.meta.url);
const CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const CAPTURE_ID = 'f8cap-b96aa2ae54e6';
const POINT_ID = 'rp-9648d81774d6';
const SPEC = {
  seed: 13,
  family: 'governance-mode-misuse',
  stage: 'post-destruction-recoverable',
  subtype: 'malicious-sabotage',
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function checkpoint(store, createdTime, content) {
  const contentSha256 = sha256(JSON.stringify(content));
  return {
    checkpoint_id: `cp-${store}-${createdTime}-${contentSha256.slice(0, 12)}`,
    store,
    created_time: createdTime,
    status: 'completed',
    immutable: true,
    viable: true,
    content_sha256: contentSha256,
    content,
  };
}

function entitlement(order) {
  return {
    event_id: order.event_id,
    order_id: order.order_id,
    customer_id: order.customer_id,
    amount_cents: order.amount_cents,
  };
}

export function produceCrossStoreExtension() {
  const captureBytes = readFileSync(CAPTURE);
  const captureHash = sha256(captureBytes);
  if (captureHash !== CAPTURE_SHA256) {
    throw new Error('native F8 v1 capture hash mismatch');
  }
  const matches = captureBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.fixture_id === CAPTURE_ID);
  if (matches.length !== 1) {
    throw new Error('selected native F8 capture must occur once');
  }
  const [capture] = matches;
  if (
    !Object.entries(SPEC).every(([field, value]) => capture._evaluator?.[field] === value) ||
    !capture.recovery_graph.recovery_points.some((point) => point.id === POINT_ID)
  ) {
    throw new Error('selected native F8 capture or recovery point mismatch');
  }
  const earlierOrder = {
    order_id: 'order-7990',
    commit_id: 'atomic-order-outbox-790',
    customer_id: 'customer-119',
    amount_cents: 2400,
    event_id: 'outbox-event-7990',
    commit_lsn: 790,
    committed_at: 70,
    acknowledged_at: 72,
    acknowledged: true,
    durable: true,
  };
  const acknowledgedOrder = {
    order_id: 'order-8041',
    commit_id: 'atomic-order-outbox-811',
    customer_id: 'customer-271',
    amount_cents: 4875,
    event_id: 'outbox-event-8041',
    commit_lsn: 811,
    committed_at: 110,
    acknowledged_at: 111,
    acknowledged: true,
    durable: true,
  };
  const laterUpdate = {
    update_id: 'address-update-812',
    order_id: acknowledgedOrder.order_id,
    customer_id: acknowledgedOrder.customer_id,
    address: 'loading-dock-4',
    commit_lsn: 812,
    committed_at: 120,
    approval_id: 'approved-address-update-812',
    approved: true,
    durable: true,
  };
  const outboxEvents = [earlierOrder, acknowledgedOrder].map((order) => ({
    event_id: order.event_id,
    commit_id: order.commit_id,
    order_id: order.order_id,
    customer_id: order.customer_id,
    amount_cents: order.amount_cents,
    commit_lsn: order.commit_lsn,
    durable: order.durable,
    authorized: order.acknowledged,
  }));
  const authorizedJournal = [
    {
      entry_id: 'journal-order-811',
      kind: 'order-commit',
      commit_id: acknowledgedOrder.commit_id,
      order_id: acknowledgedOrder.order_id,
      event_id: acknowledgedOrder.event_id,
      approved: true,
      durable: true,
    },
    {
      entry_id: 'journal-address-812',
      kind: 'address-update',
      order_id: acknowledgedOrder.order_id,
      update_id: laterUpdate.update_id,
      approval_id: laterUpdate.approval_id,
      approved: true,
      durable: true,
    },
  ];
  const aOldContent = {
    orders: { [earlierOrder.order_id]: earlierOrder },
    outbox_event_ids: [earlierOrder.event_id],
    address_updates: {},
  };
  const aLatestContent = {
    orders: {
      [earlierOrder.order_id]: earlierOrder,
      [acknowledgedOrder.order_id]: acknowledgedOrder,
    },
    outbox_event_ids: [earlierOrder.event_id, acknowledgedOrder.event_id],
    address_updates: { [laterUpdate.order_id]: laterUpdate },
  };
  const bPendingContent = {
    entitlements: { [earlierOrder.event_id]: [entitlement(earlierOrder)] },
    applied_event_ids: [earlierOrder.event_id],
    applied_event_receipts: {
      [earlierOrder.event_id]: { event_id: earlierOrder.event_id, applied_at: 80 },
    },
  };
  const bAppliedContent = {
    entitlements: {
      [earlierOrder.event_id]: [entitlement(earlierOrder)],
      [acknowledgedOrder.event_id]: [entitlement(acknowledgedOrder)],
    },
    applied_event_ids: [earlierOrder.event_id, acknowledgedOrder.event_id],
    applied_event_receipts: {
      [earlierOrder.event_id]: { event_id: earlierOrder.event_id, applied_at: 80 },
      [acknowledgedOrder.event_id]: { event_id: acknowledgedOrder.event_id, applied_at: 125 },
    },
  };
  return {
    contract_id: 'f8-cross-store-extension-v1',
    base_capture: {
      fixture_id: capture.fixture_id,
      sha256: captureHash,
      point_id: POINT_ID,
      spec: { ...SPEC },
    },
    common: {
      earlier_order: earlierOrder,
      acknowledged_order: acknowledgedOrder,
      later_update: laterUpdate,
      outbox_events: outboxEvents,
      authorized_journal: authorizedJournal,
      a_checkpoints: {
        older: checkpoint('orders', 90, aOldContent),
        latest: checkpoint('orders', 130, aLatestContent),
      },
      b_older_checkpoint: checkpoint('entitlements', 90, bPendingContent),
    },
    cases: [
      {
        case_id: 'v16-projection-applied',
        b_latest_checkpoint: checkpoint('entitlements', 130, bAppliedContent),
      },
      {
        case_id: 'v16-projection-pending',
        b_latest_checkpoint: checkpoint('entitlements', 130, bPendingContent),
      },
    ],
    lineage: {
      native_capture: {
        origin: 'native-F8-v1',
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
      application_inputs: {
        origin: 'authored-synthetic-v16',
        native_v1: false,
        fields: [
          'common.earlier_order',
          'common.acknowledged_order',
          'common.later_update',
          'common.outbox_events',
          'common.authorized_journal',
          'common.a_checkpoints',
          'common.b_older_checkpoint',
          'cases[*].b_latest_checkpoint',
        ],
      },
      application_outputs: {
        origin: 'simulator-derived-v16',
        native_v1: false,
        fields: ['checkpoint restore', 'order and entitlement readback', 'outbox replay effects'],
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-cross-store-extension.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceCrossStoreExtension(), null, 2)}\n`);
}
