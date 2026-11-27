// Synthetic F8 v17 application projection. Native v1 is used only for the recovery incident.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-causal-projection-v1.json', import.meta.url);
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
    checkpoint_id: `cp-v17-${store}-${createdTime}-${contentSha256.slice(0, 12)}`,
    store,
    created_time: createdTime,
    status: 'completed',
    immutable: true,
    viable: true,
    content_sha256: contentSha256,
    content,
  };
}

function entitlement(active, version, eventIds) {
  return { active, last_applied_version: version, applied_event_ids: eventIds };
}

export function produceCausalProjectionPair() {
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
  const unrelatedGrant = {
    event_id: 'evt-v17-unrelated-431',
    kind: 'grant',
    order_id: 'order-v17-unrelated-431',
    commit_id: 'atomic-v17-431',
    entitlement_key: 'entitlement-v17-unrelated-431',
    customer_id: 'customer-v17-431',
    amount_cents: 2900,
    aggregate_version: 1,
    committed_at: 70,
    acknowledged_at: 72,
    effective_at: 72,
    acknowledged: true,
    approved: true,
    durable: true,
  };
  const targetGrant = {
    event_id: 'evt-v17-grant-572',
    kind: 'grant',
    order_id: 'order-v17-target-572',
    commit_id: 'atomic-v17-572',
    entitlement_key: 'entitlement-v17-target-572',
    customer_id: 'customer-v17-572',
    amount_cents: 6450,
    aggregate_version: 1,
    committed_at: 110,
    acknowledged_at: 111,
    effective_at: 111,
    acknowledged: true,
    approved: true,
    durable: true,
  };
  const laterUpdate = {
    update_id: 'address-v17-573',
    order_id: targetGrant.order_id,
    address: 'delivery-bay-9',
    committed_at: 118,
    approval_id: 'approved-v17-address-573',
    approved: true,
    durable: true,
  };
  const reversal = {
    event_id: 'evt-v17-reversal-574',
    kind: 'reversal',
    order_id: targetGrant.order_id,
    commit_id: 'reversal-v17-574',
    entitlement_key: targetGrant.entitlement_key,
    customer_id: targetGrant.customer_id,
    amount_cents: targetGrant.amount_cents,
    aggregate_version: 2,
    committed_at: 123,
    effective_at: 124,
    authorization_id: 'approved-v17-reversal-574',
    approved: true,
    durable: true,
  };
  const orders = {
    [unrelatedGrant.order_id]: unrelatedGrant,
    [targetGrant.order_id]: targetGrant,
  };
  const aOldContent = {
    orders: { [unrelatedGrant.order_id]: unrelatedGrant },
    outbox_event_ids: [unrelatedGrant.event_id],
    address_updates: {},
    reversal_receipts: {},
  };
  const aDueContent = {
    orders,
    outbox_event_ids: [unrelatedGrant.event_id, targetGrant.event_id],
    address_updates: { [targetGrant.order_id]: laterUpdate },
    reversal_receipts: {},
  };
  const aReversedContent = {
    ...aDueContent,
    outbox_event_ids: [...aDueContent.outbox_event_ids, reversal.event_id],
    reversal_receipts: { [reversal.event_id]: reversal },
  };
  const bOldContent = {
    entitlements: {
      [unrelatedGrant.entitlement_key]: entitlement(true, 1, [unrelatedGrant.event_id]),
      [targetGrant.entitlement_key]: entitlement(false, 0, []),
    },
    applied_event_receipts: {
      [unrelatedGrant.event_id]: { event_id: unrelatedGrant.event_id, applied_at: 80 },
    },
  };
  const bReversedContent = {
    entitlements: {
      ...bOldContent.entitlements,
      [targetGrant.entitlement_key]: entitlement(false, 2, [reversal.event_id]),
    },
    applied_event_receipts: {
      ...bOldContent.applied_event_receipts,
      [reversal.event_id]: { event_id: reversal.event_id, applied_at: 128 },
    },
  };
  return {
    contract_id: 'f8-causal-projection-extension-v1',
    base_capture: {
      fixture_id: capture.fixture_id,
      sha256: captureHash,
      point_id: POINT_ID,
      spec: { ...SPEC },
    },
    projection_contract: {
      ordered_per_key: false,
      deduplication: 'event-id-only',
      aggregate_version_fence: false,
      effect: 'last applied event overwrites active status even if its aggregate version is older',
    },
    common: {
      unrelated_grant: unrelatedGrant,
      target_grant: targetGrant,
      later_update: laterUpdate,
      a_older_checkpoint: checkpoint('orders', 90, aOldContent),
      b_older_checkpoint: checkpoint('entitlements', 90, bOldContent),
    },
    cases: [
      {
        case_id: 'v17-grant-due',
        source_events: [unrelatedGrant, targetGrant],
        a_latest_checkpoint: checkpoint('orders', 130, aDueContent),
        b_latest_checkpoint: checkpoint('entitlements', 130, bOldContent),
      },
      {
        case_id: 'v17-grant-reversed',
        source_events: [unrelatedGrant, targetGrant, reversal],
        a_latest_checkpoint: checkpoint('orders', 130, aReversedContent),
        b_latest_checkpoint: checkpoint('entitlements', 130, bReversedContent),
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
        origin: 'authored-synthetic-v17',
        native_v1: false,
        fields: [
          'common.*',
          'cases[*].source_events',
          'cases[*].a_latest_checkpoint',
          'cases[*].b_latest_checkpoint',
          'projection_contract',
        ],
      },
      application_outputs: {
        origin: 'simulator-derived-v17',
        native_v1: false,
        fields: [
          'checkpoint restore',
          'per-key projection replay',
          'applied-event receipt',
          'application readback',
        ],
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-causal-projection.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceCausalProjectionPair(), null, 2)}\n`);
}
