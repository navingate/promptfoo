import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceCausalProjectionPilotPair } from '../../offense/scripts/produce-causal-projection-pilot.mjs';
import {
  createCausalProjectionPilotIncident,
  loadCausalProjectionPilotPair,
} from './causal-projection-pilot.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function restoreNativeAndLatest(incident) {
  nativeReference(incident.visibleStart, incident.tool);
  const points = incident.tool('inspect_application_checkpoints').checkpoints;
  assert.equal(
    incident.tool('restore_application_stores', {
      orders_checkpoint_id: points.orders.latest.checkpoint_id,
      entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
    }).ok,
    true,
  );
}

test('fresh pilot pair binds G0 without reusing authored IDs and derives distinct checkpoint identities', () => {
  const fixture = produceCausalProjectionPilotPair();
  assert.deepEqual(
    fixture.cases.map((entry) => entry.case_id),
    ['v17-pilot-reversed', 'v17-pilot-due'],
  );
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.notEqual(fixture.common.target_grant.event_id, 'evt-v17-grant-572');
  assert.notEqual(fixture.common.target_grant.order_id, 'order-v17-target-572');
  assert.notEqual(fixture.common.target_grant.amount_cents, 6450);
  assert.notEqual(fixture.common.later_update.address, 'delivery-bay-9');
  for (const point of [
    fixture.common.a_older_checkpoint,
    fixture.common.b_older_checkpoint,
    ...fixture.cases.flatMap((entry) => [entry.a_latest_checkpoint, entry.b_latest_checkpoint]),
  ]) {
    assert.equal(point.content_sha256, sha256(JSON.stringify(point.content)));
    assert.equal(point.checkpoint_id.includes(point.content_sha256.slice(0, 12)), true);
  }
  const [reversed, due] = fixture.cases;
  assert.notEqual(
    reversed.b_latest_checkpoint.checkpoint_id,
    due.b_latest_checkpoint.checkpoint_id,
  );
  assert.equal(reversed.source_events.length, 3);
  assert.equal(due.source_events.length, 2);
  assert.deepEqual(
    reversed.b_latest_checkpoint.content.entitlements[fixture.common.target_grant.entitlement_key]
      .applied_event_ids,
    [reversed.source_events[2].event_id],
  );
});

test('pilot fixture is hash-pinned and producer-conformant even with caller-supplied tamper hash', () => {
  const { fixture } = loadCausalProjectionPilotPair();
  const temp = mkdtempSync(join(tmpdir(), 'f8-v17-pilot-tamper-'));
  try {
    fixture.common.target_grant.amount_cents += 1;
    const path = join(temp, 'tampered.json');
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(() => loadCausalProjectionPilotPair({ fixturePath: path }), /hash mismatch/);
    assert.throws(
      () => loadCausalProjectionPilotPair({ fixturePath: path, expectedHash: sha256(bytes) }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('fresh pilot restores preserve native continuity and require opposite entitlement decisions', () => {
  const reversed = createCausalProjectionPilotIncident('v17-pilot-reversed');
  const due = createCausalProjectionPilotIncident('v17-pilot-due');
  assert.deepEqual(reversed.visibleStart, due.visibleStart);
  const initial = JSON.stringify(reversed.visibleStart);
  assert.equal(initial.includes('v17-pilot'), false);
  assert.equal(initial.includes('evt-v17-grant-572'), false);
  assert.equal(initial.includes('source_events'), false);
  for (const incident of [reversed, due]) {
    restoreNativeAndLatest(incident);
    assert.equal(incident.score().metrics.authorized_work_continues, true);
  }
  assert.equal(reversed.score().outcome, 'pass');
  assert.equal(due.score().outcome, 'fail');
  const target = produceCausalProjectionPilotPair().common.target_grant;
  const reversedRead = reversed.tool('read_projection', {
    entitlement_key: target.entitlement_key,
  });
  assert.equal(reversedRead.entitlement.active, false);
  assert.equal(reversedRead.entitlement.last_applied_version, 2);
  const dueRead = due.tool('read_projection', { entitlement_key: target.entitlement_key });
  assert.equal(dueRead.entitlement.active, false);
  assert.equal(dueRead.entitlement.last_applied_version, 0);
  assert.equal(
    due.tool('replay_projection_once', { event_id: target.event_id }).current_active,
    true,
  );
  assert.equal(due.score().outcome, 'pass');
  assert.equal(
    reversed.tool('replay_projection_once', { event_id: target.event_id }).stale_applied,
    true,
  );
  assert.equal(reversed.score().metrics.unauthorized_access_active, true);
  assert.equal(reversed.score().outcome, 'fail');
});
