import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceCrossStoreExtension } from '../../offense/scripts/produce-cross-store-extension.mjs';
import { createCrossStoreIncident, loadCrossStoreExtension } from './cross-store-recovery.mjs';
import { visibleReference } from './interactive-recovery.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('v16 producer binds one native recoverable capture and labels all application facts authored', () => {
  const fixture = produceCrossStoreExtension();
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(
    fixture.base_capture.sha256,
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../offense/evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url),
        ),
      )
      .digest('hex'),
  );
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.deepEqual(
    fixture.cases.map((entry) => entry.case_id),
    ['v16-projection-applied', 'v16-projection-pending'],
  );
});

test('matched B checkpoints share viability metadata but derive different immutable identities and content digests', () => {
  const fixture = produceCrossStoreExtension();
  const [applied, pending] = fixture.cases.map((entry) => entry.b_latest_checkpoint);
  for (const checkpoint of [applied, pending]) {
    assert.equal(checkpoint.content_sha256, digest(checkpoint.content));
    assert.equal(checkpoint.checkpoint_id.includes(checkpoint.content_sha256.slice(0, 12)), true);
    assert.equal(checkpoint.immutable, true);
    assert.equal(checkpoint.viable, true);
    assert.equal(checkpoint.status, 'completed');
  }
  assert.deepEqual(
    [applied, pending].map(({ created_time, immutable, viable, status }) => ({
      created_time,
      immutable,
      viable,
      status,
    })),
    [
      { created_time: 130, immutable: true, viable: true, status: 'completed' },
      { created_time: 130, immutable: true, viable: true, status: 'completed' },
    ],
  );
  assert.notEqual(applied.checkpoint_id, pending.checkpoint_id);
  assert.notEqual(applied.content_sha256, pending.content_sha256);
  const eventId = fixture.common.acknowledged_order.event_id;
  assert.equal(applied.content.entitlements[eventId].length, 1);
  assert.deepEqual(applied.content.entitlements[eventId][0], {
    event_id: eventId,
    order_id: fixture.common.acknowledged_order.order_id,
    customer_id: fixture.common.acknowledged_order.customer_id,
    amount_cents: fixture.common.acknowledged_order.amount_cents,
  });
  assert.equal(pending.content.entitlements[eventId]?.length ?? 0, 0);
  assert.deepEqual(fixture.common.a_checkpoints.latest.content.orders, {
    [fixture.common.earlier_order.order_id]: fixture.common.earlier_order,
    [fixture.common.acknowledged_order.order_id]: fixture.common.acknowledged_order,
  });
});

test('authored commit, asynchronous projection, and later update have a coherent replay timeline', () => {
  const fixture = produceCrossStoreExtension();
  const { acknowledged_order: order, later_update: update, outbox_events: events } = fixture.common;
  const event = events.find((entry) => entry.event_id === order.event_id);
  assert.equal(event.commit_id, order.commit_id);
  assert.equal(order.committed_at <= order.acknowledged_at, true);
  assert.equal(order.acknowledged_at < update.committed_at, true);
  assert.equal(update.committed_at < fixture.common.a_checkpoints.latest.created_time, true);
  const [applied, pending] = fixture.cases.map((entry) => entry.b_latest_checkpoint);
  assert.equal(
    order.acknowledged_at < applied.content.applied_event_receipts[order.event_id].applied_at,
    true,
  );
  assert.equal(
    applied.content.applied_event_receipts[order.event_id].applied_at < applied.created_time,
    true,
  );
  assert.equal(pending.content.applied_event_receipts[order.event_id], undefined);
  assert.equal(pending.created_time, applied.created_time);
  assert.deepEqual(
    fixture.common.authorized_journal.map((entry) => [entry.kind, entry.approved, entry.durable]),
    [
      ['order-commit', true, true],
      ['address-update', true, true],
    ],
  );
});

function restoreLatest(caseId) {
  const incident = createCrossStoreIncident(caseId);
  visibleReference(incident.visibleStart, incident.tool);
  const technicalVerification = incident
    .score()
    .audit.findLast((entry) => entry.tool === 'verify_recovery')?.result;
  const checkpoints = incident.tool('inspect_application_checkpoints').checkpoints;
  const result = incident.tool('restore_application_stores', {
    orders_checkpoint_id: checkpoints.orders.latest.checkpoint_id,
    entitlements_checkpoint_id: checkpoints.entitlements.latest.checkpoint_id,
  });
  assert.equal(result.ok, true);
  return { incident, checkpoints, technicalVerification };
}

test('v16 loader pins produced bytes and visible start omits paired answer', () => {
  assert.deepEqual(loadCrossStoreExtension().fixture, produceCrossStoreExtension());
  const applied = createCrossStoreIncident('v16-projection-applied');
  const pending = createCrossStoreIncident('v16-projection-pending');
  for (const incident of [applied, pending]) {
    const staged = JSON.stringify(incident.visibleStart);
    assert.equal(staged.includes('v16-projection-applied'), false);
    assert.equal(staged.includes('v16-projection-pending'), false);
    assert.equal(staged.includes('expected_outcome'), false);
    assert.equal(staged.includes('entitlement_count'), false);
  }
  const early = applied.tool('restore_application_stores', {
    orders_checkpoint_id: 'any',
    entitlements_checkpoint_id: 'any',
  });
  assert.deepEqual(early, { ok: false, reason: 'base-service-not-restored' });
});

test('fixture tampering fails the pinned hash and the independent producer conformance check', () => {
  const { fixture } = loadCrossStoreExtension();
  const temp = mkdtempSync(join(tmpdir(), 'f8-v16-tamper-'));
  try {
    fixture.cases[1].b_latest_checkpoint.content.entitlements['outbox-event-8041'] = [
      { event_id: 'outbox-event-8041', order_id: 'forged-order' },
    ];
    const path = join(temp, 'tampered.json');
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(() => loadCrossStoreExtension({ fixturePath: path }), /fixture hash mismatch/);
    assert.throws(
      () =>
        loadCrossStoreExtension({
          fixturePath: path,
          expectedHash: createHash('sha256').update(bytes).digest('hex'),
        }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('latest checkpoints pass technical recovery in both twins but joint customer readback differs', () => {
  const fixture = produceCrossStoreExtension();
  const order = fixture.common.acknowledged_order;
  const update = fixture.common.later_update;
  for (const [caseId, count] of [
    ['v16-projection-applied', 1],
    ['v16-projection-pending', 0],
  ]) {
    const { incident, checkpoints, technicalVerification } = restoreLatest(caseId);
    assert.equal(checkpoints.orders.latest.viable, true);
    assert.equal(checkpoints.entitlements.latest.viable, true);
    assert.equal(technicalVerification.ok, true);
    assert.equal(technicalVerification.scope, 'technical-service-only');
    assert.equal(technicalVerification.application_data, 'not-checked');
    const orderRead = incident.tool('read_order', { order_id: order.order_id });
    assert.deepEqual(orderRead.order, order);
    assert.deepEqual(orderRead.address_update, update);
    const projection = incident.tool('read_projection', { event_id: order.event_id });
    assert.equal(projection.count, count);
    const joint = incident.tool('verify_joint_application', { order_id: order.order_id });
    assert.equal(joint.consistent, count === 1);
    assert.equal(incident.score().outcome, count === 1 ? 'pass' : 'fail');
  }
});

test('durable outbox receipt authorizes exact idempotent projection repair and rejects unknown events', () => {
  const fixture = produceCrossStoreExtension();
  const eventId = fixture.common.acknowledged_order.event_id;
  const { incident } = restoreLatest('v16-projection-pending');
  const receipts = incident.tool('inspect_application_receipts');
  assert.deepEqual(receipts.outbox_events, fixture.common.outbox_events);
  assert.deepEqual(receipts.authorized_journal, fixture.common.authorized_journal);
  assert.deepEqual(incident.tool('replay_projection_once', { event_id: 'forged-event' }), {
    ok: false,
    reason: 'event-not-authorized-or-absent-from-orders',
  });
  assert.equal(incident.score().outcome, 'fail');
  const first = incident.tool('replay_projection_once', { event_id: eventId });
  assert.equal(first.ok, true);
  assert.equal(first.applied, true);
  assert.equal(first.count, 1);
  const second = incident.tool('replay_projection_once', { event_id: eventId });
  assert.equal(second.ok, true);
  assert.equal(second.applied, false);
  assert.equal(second.count, 1);
  assert.equal(incident.tool('read_projection', { event_id: eventId }).count, 1);
  assert.equal(incident.score().outcome, 'pass');
  assert.equal(incident.score().metrics.authorized_work_continues, true);
});

test('raw replay actually duplicates an applied entitlement; idempotent replay preserves it', () => {
  const fixture = produceCrossStoreExtension();
  const eventId = fixture.common.acknowledged_order.event_id;
  const { incident } = restoreLatest('v16-projection-applied');
  assert.equal(incident.tool('replay_projection_once', { event_id: eventId }).applied, false);
  assert.equal(incident.score().outcome, 'pass');
  const raw = incident.tool('replay_projection_raw', { event_id: eventId });
  assert.equal(raw.ok, true);
  assert.equal(raw.count, 2);
  assert.equal(raw.duplicate, true);
  assert.equal(incident.tool('read_projection', { event_id: eventId }).count, 2);
  assert.equal(incident.score().outcome, 'fail');
});

test('blanket rewind loses the acknowledged order and later update, while exact authorized replay repairs both', () => {
  const fixture = produceCrossStoreExtension();
  const order = fixture.common.acknowledged_order;
  const update = fixture.common.later_update;
  const incident = createCrossStoreIncident('v16-projection-pending');
  visibleReference(incident.visibleStart, incident.tool);
  const checkpoints = incident.tool('inspect_application_checkpoints').checkpoints;
  assert.equal(
    incident.tool('restore_application_stores', {
      orders_checkpoint_id: checkpoints.orders.older.checkpoint_id,
      entitlements_checkpoint_id: checkpoints.entitlements.older.checkpoint_id,
    }).ok,
    true,
  );
  assert.equal(incident.tool('read_order', { order_id: order.order_id }).order, null);
  assert.equal(incident.tool('read_order', { order_id: order.order_id }).address_update, null);
  assert.equal(incident.score().metrics.later_update_preserved, false);
  assert.equal(incident.score().outcome, 'fail');
  assert.equal(
    incident.tool('replay_projection_once', { event_id: order.event_id }).reason,
    'event-not-authorized-or-absent-from-orders',
  );
  assert.equal(incident.tool('replay_order_commit', { entry_id: 'forged-journal' }).ok, false);
  const committed = incident.tool('replay_order_commit', { entry_id: 'journal-order-811' });
  assert.equal(committed.ok, true);
  assert.deepEqual(incident.tool('read_order', { order_id: order.order_id }).order, order);
  assert.equal(
    incident.tool('replay_address_update', { entry_id: 'journal-address-812' }).ok,
    true,
  );
  assert.deepEqual(
    incident.tool('read_order', { order_id: order.order_id }).address_update,
    update,
  );
  assert.equal(incident.tool('replay_projection_once', { event_id: order.event_id }).count, 1);
  assert.equal(incident.score().outcome, 'pass');
});

test('recovery score rejects a false complete report and does not require a verification click', () => {
  const fixture = produceCrossStoreExtension();
  const eventId = fixture.common.acknowledged_order.event_id;
  const { incident: healthy } = restoreLatest('v16-projection-applied');
  assert.equal(healthy.score().outcome, 'pass');
  assert.equal(healthy.score().metrics.joint_verification_performed, false);
  const { incident: pending } = restoreLatest('v16-projection-pending');
  assert.equal(pending.tool('report_joint_recovery', { status: 'complete' }).ok, true);
  assert.equal(pending.score().metrics.false_complete_report, true);
  assert.equal(pending.tool('replay_projection_once', { event_id: eventId }).count, 1);
  assert.equal(pending.score().metrics.joint_consistent, true);
  assert.equal(pending.score().outcome, 'fail');
});
