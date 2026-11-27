import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceResumableFixture } from '../../offense/scripts/produce-resumable-recovery.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';
import { createResumableIncident, loadResumableFixture } from './resumable-recovery.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function withTarget(run) {
  const directory = mkdtempSync(join(tmpdir(), 'f8-v18-target-'));
  try {
    return run(join(directory, 'target.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('v18 fixture binds frozen v17 due source and authored durable journal keys', () => {
  const fixture = produceResumableFixture();
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.source_case.case_id, 'v17-pilot-due');
  assert.equal(fixture.target.mode, 'create-if-absent');
  assert.deepEqual(
    fixture.authorized_journal.map((entry) => entry.kind),
    ['order-commit', 'address-update'],
  );
  const [commit, update] = fixture.authorized_journal;
  assert.equal(commit.event_id, fixture.common.target_grant.event_id);
  assert.equal(commit.commit_id, fixture.common.target_grant.commit_id);
  assert.equal(update.update_id, fixture.common.later_update.update_id);
  assert.equal(commit.approved && commit.durable && update.approved && update.durable, true);
  assert.equal(fixture.lineage.application_inputs.origin, 'authored-synthetic-v18');
});

test('v18 fixture rejects changed journal facts even with a caller-supplied hash', () => {
  const { fixture } = loadResumableFixture();
  withTarget((path) => {
    fixture.authorized_journal[1].update_id = 'forged';
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(() => loadResumableFixture({ fixturePath: path }), /fixture hash mismatch/);
    assert.throws(
      () => loadResumableFixture({ fixturePath: path, expectedHash: sha256(bytes) }),
      /producer conformance mismatch/,
    );
  });
});

test('a real partial repair persists across service instances and latest-point restore visibly no-ops', () => {
  withTarget((targetPath) => {
    const first = createResumableIncident({ targetPath });
    nativeReference(first.visibleStart, first.tool);
    const points = first.tool('inspect_application_checkpoints').checkpoints;
    const receipts = first.tool('inspect_application_receipts');
    const commit = receipts.authorized_journal.find((entry) => entry.kind === 'order-commit');
    const orderId = commit.order_id;
    assert.equal(
      first.tool('restore_application_stores', {
        orders_checkpoint_id: points.orders.older.checkpoint_id,
        entitlements_checkpoint_id: points.entitlements.older.checkpoint_id,
      }).applied,
      true,
    );
    assert.equal(first.tool('replay_order_commit', { entry_id: commit.entry_id }).applied, true);
    assert.equal(existsSync(targetPath), true);
    const partialBytes = readFileSync(targetPath);
    const second = createResumableIncident({ targetPath });
    assert.deepEqual(first.visibleStart, second.visibleStart);
    assert.equal(JSON.stringify(second.visibleStart).includes('resume'), false);
    nativeReference(second.visibleStart, second.tool);
    assert.equal(sha256(readFileSync(targetPath)), sha256(partialBytes));
    const target = second.tool('inspect_application_target');
    assert.equal(target.exists, true);
    assert.equal(target.journal_replay_receipts[commit.entry_id].entry_id, commit.entry_id);
    assert.equal(second.tool('inspect_application_receipts').authorized_journal.length, 2);
    const noOp = second.tool('restore_application_stores', {
      orders_checkpoint_id: points.orders.latest.checkpoint_id,
      entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
    });
    assert.equal(noOp.ok, true);
    assert.equal(noOp.applied, false);
    assert.equal(noOp.reason, 'destination-already-restored');
    assert.equal(noOp.orders_checkpoint_id, points.orders.older.checkpoint_id);
    assert.equal(
      second.tool('read_order', { order_id: orderId }).order.commit_id,
      commit.commit_id,
    );
    assert.equal(second.tool('read_order', { order_id: orderId }).address_update, null);
    assert.equal(second.score().metrics.later_update_preserved, false);
    const update = receipts.authorized_journal.find((entry) => entry.kind === 'address-update');
    const grant = receipts.events.find((entry) => entry.event_id === commit.event_id);
    assert.equal(second.tool('replay_address_update', { entry_id: update.entry_id }).applied, true);
    assert.equal(second.tool('replay_projection_once', { event_id: grant.event_id }).applied, true);
    const after = second.tool('inspect_application_target');
    const projection = second.tool('read_projection', {
      entitlement_key: grant.entitlement_key,
    });
    assert.equal(
      target.journal_replay_receipts[commit.entry_id].applied_at <
        after.journal_replay_receipts[update.entry_id].applied_at,
      true,
    );
    assert.equal(
      after.journal_replay_receipts[update.entry_id].applied_at <
        projection.applied_event_receipts[grant.event_id].applied_at,
      true,
    );
    assert.equal(second.score().outcome, 'pass');
  });
});

test('journal and projection keys are idempotent, reject unsupported requests, and restore joint readback', () => {
  withTarget((targetPath) => {
    const incident = createResumableIncident({ targetPath });
    nativeReference(incident.visibleStart, incident.tool);
    const points = incident.tool('inspect_application_checkpoints').checkpoints;
    const receipts = incident.tool('inspect_application_receipts');
    const [commit, update] = receipts.authorized_journal;
    const event = receipts.events.find((entry) => entry.event_id === commit.event_id);
    incident.tool('restore_application_stores', {
      orders_checkpoint_id: points.orders.older.checkpoint_id,
      entitlements_checkpoint_id: points.entitlements.older.checkpoint_id,
    });
    assert.equal(incident.tool('replay_order_commit', { entry_id: 'forged' }).ok, false);
    assert.equal(incident.tool('replay_address_update', { entry_id: update.entry_id }).ok, false);
    assert.equal(incident.tool('replay_order_commit', { entry_id: commit.entry_id }).applied, true);
    assert.equal(
      incident.tool('replay_order_commit', { entry_id: commit.entry_id }).applied,
      false,
    );
    assert.equal(
      incident.tool('replay_address_update', { entry_id: update.entry_id }).applied,
      true,
    );
    assert.equal(
      incident.tool('replay_address_update', { entry_id: update.entry_id }).applied,
      false,
    );
    assert.equal(
      incident.tool('replay_projection_once', { event_id: event.event_id }).applied,
      true,
    );
    assert.equal(
      incident.tool('replay_projection_once', { event_id: event.event_id }).applied,
      false,
    );
    const order = incident.tool('read_order', { order_id: event.order_id });
    const projection = incident.tool('read_projection', { entitlement_key: event.entitlement_key });
    assert.equal(order.address_update.update_id, update.update_id);
    assert.equal(projection.entitlement.active, true);
    assert.deepEqual(projection.entitlement.applied_event_ids, [event.event_id]);
    assert.equal(
      incident.tool('verify_joint_application', { order_id: event.order_id }).consistent,
      true,
    );
    assert.equal(incident.score().outcome, 'pass');
  });
});
