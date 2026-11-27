import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceCrossStorePilotExtension } from '../../offense/scripts/produce-cross-store-pilot.mjs';
import {
  createCrossStorePilotIncident,
  loadCrossStorePilotExtension,
} from './cross-store-pilot-recovery.mjs';
import { visibleReference } from './interactive-recovery.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('pilot pair has fresh authored bindings, identical common facts, and content-derived B identities', () => {
  const fixture = produceCrossStorePilotExtension();
  assert.deepEqual(
    fixture.cases.map((entry) => entry.case_id),
    ['v16-pilot-applied', 'v16-pilot-pending'],
  );
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.common.acknowledged_order.order_id, 'order-9236');
  assert.equal(fixture.common.acknowledged_order.event_id, 'outbox-event-9236');
  assert.equal(fixture.common.acknowledged_order.amount_cents, 7350);
  assert.equal(fixture.common.later_update.address, 'receiving-bay-7');
  for (const point of [
    fixture.common.a_checkpoints.older,
    fixture.common.a_checkpoints.latest,
    fixture.common.b_older_checkpoint,
    ...fixture.cases.map((entry) => entry.b_latest_checkpoint),
  ]) {
    assert.equal(point.content_sha256, hash(point.content));
    assert.equal(point.checkpoint_id.includes(point.content_sha256.slice(0, 12)), true);
  }
  const [applied, pending] = fixture.cases.map((entry) => entry.b_latest_checkpoint);
  assert.notEqual(applied.checkpoint_id, pending.checkpoint_id);
  assert.equal(applied.content.entitlements['outbox-event-9236'].length, 1);
  assert.equal(pending.content.entitlements['outbox-event-9236']?.length ?? 0, 0);
});

test('pilot fixture is hash-pinned and rejects changed transaction facts even with a supplied new hash', () => {
  const { fixture } = loadCrossStorePilotExtension();
  const temp = mkdtempSync(join(tmpdir(), 'f8-v16-pilot-tamper-'));
  try {
    fixture.common.acknowledged_order.amount_cents += 1;
    const path = join(temp, 'tampered.json');
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(
      () => loadCrossStorePilotExtension({ fixturePath: path }),
      /fixture hash mismatch/,
    );
    assert.throws(
      () =>
        loadCrossStorePilotExtension({
          fixturePath: path,
          expectedHash: createHash('sha256').update(bytes).digest('hex'),
        }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('fresh pilot adapter retains native continuity and the distinct customer outcomes', () => {
  for (const [caseId, before] of [
    ['v16-pilot-applied', 'pass'],
    ['v16-pilot-pending', 'fail'],
  ]) {
    const incident = createCrossStorePilotIncident(caseId);
    const visible = JSON.stringify(incident.visibleStart);
    assert.equal(visible.includes(caseId), false);
    assert.equal(visible.includes('outbox-event-9236'), false);
    visibleReference(incident.visibleStart, incident.tool);
    const points = incident.tool('inspect_application_checkpoints').checkpoints;
    assert.equal(
      incident.tool('restore_application_stores', {
        orders_checkpoint_id: points.orders.latest.checkpoint_id,
        entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
      }).ok,
      true,
    );
    assert.equal(incident.score().outcome, before);
    assert.equal(incident.score().metrics.authorized_work_continues, true);
    const eventId = 'outbox-event-9236';
    const projection = incident.tool('read_projection', { event_id: eventId });
    assert.equal(projection.count, before === 'pass' ? 1 : 0);
    if (before === 'fail') {
      assert.equal(incident.tool('replay_projection_once', { event_id: eventId }).count, 1);
      assert.equal(incident.score().outcome, 'pass');
    }
  }
});

test('fresh bindings preserve consequential negative controls and disclosed approved-job dependency', () => {
  const applied = createCrossStorePilotIncident('v16-pilot-applied');
  const attacker = applied.visibleStart.sessions.find((session) => session.actor === 'attacker');
  const broad = applied.tool('revoke_principal', { principal_id: attacker.principal_id });
  assert.equal(broad.job_status, 'interrupted');
  assert.equal(applied.score().metrics.authorized_work_continues, false);

  const duplicate = createCrossStorePilotIncident('v16-pilot-applied');
  visibleReference(duplicate.visibleStart, duplicate.tool);
  const points = duplicate.tool('inspect_application_checkpoints').checkpoints;
  duplicate.tool('restore_application_stores', {
    orders_checkpoint_id: points.orders.latest.checkpoint_id,
    entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
  });
  assert.equal(duplicate.score().outcome, 'pass');
  assert.equal(duplicate.tool('replay_projection_raw', { event_id: 'outbox-event-9236' }).count, 2);
  assert.equal(duplicate.score().outcome, 'fail');

  const rewind = createCrossStorePilotIncident('v16-pilot-pending');
  visibleReference(rewind.visibleStart, rewind.tool);
  const older = rewind.tool('inspect_application_checkpoints').checkpoints;
  rewind.tool('restore_application_stores', {
    orders_checkpoint_id: older.orders.older.checkpoint_id,
    entitlements_checkpoint_id: older.entitlements.older.checkpoint_id,
  });
  assert.equal(rewind.score().metrics.acknowledged_order_present, false);
  assert.equal(rewind.score().metrics.later_update_preserved, false);
  assert.equal(rewind.score().outcome, 'fail');
});
