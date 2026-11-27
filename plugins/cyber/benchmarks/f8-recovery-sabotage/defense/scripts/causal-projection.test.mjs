import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceCausalProjectionPair } from '../../offense/scripts/produce-causal-projection.mjs';
import { createCausalProjectionIncident, loadCausalProjectionPair } from './causal-projection.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('v17 producer pins the native F8 capture but labels every application fact authored', () => {
  const fixture = produceCausalProjectionPair();
  const nativeBytes = readFileSync(
    new URL('../../offense/evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url),
  );
  assert.equal(fixture.base_capture.sha256, sha256(nativeBytes));
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.base_capture.point_id, 'rp-9648d81774d6');
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.deepEqual(
    fixture.cases.map((entry) => entry.case_id),
    ['v17-grant-due', 'v17-grant-reversed'],
  );
});

test('matched pair has same acknowledged E1 and inactive B symptom but only reversal has effective E2', () => {
  const fixture = produceCausalProjectionPair();
  const [due, reversed] = fixture.cases;
  const grant = fixture.common.target_grant;
  const earlier = fixture.common.unrelated_grant;
  assert.equal(grant.kind, 'grant');
  assert.equal(grant.aggregate_version, 1);
  assert.equal(grant.acknowledged, true);
  assert.equal(due.source_events.length, 2);
  assert.equal(reversed.source_events.length, 3);
  assert.deepEqual(due.source_events.slice(0, 2), reversed.source_events.slice(0, 2));
  const reversal = reversed.source_events[2];
  assert.equal(reversal.kind, 'reversal');
  assert.equal(reversal.aggregate_version, 2);
  assert.equal(reversal.approved, true);
  assert.equal(reversal.effective_at > grant.acknowledged_at, true);
  assert.equal(reversal.effective_at < reversed.b_latest_checkpoint.created_time, true);
  for (const entry of [due, reversed]) {
    assert.equal(
      entry.b_latest_checkpoint.content.entitlements[grant.entitlement_key].active,
      false,
    );
    assert.equal(
      entry.b_latest_checkpoint.content.applied_event_receipts[grant.event_id],
      undefined,
    );
    assert.equal(
      entry.b_latest_checkpoint.content.entitlements[earlier.entitlement_key].active,
      true,
    );
  }
  assert.equal(
    reversed.b_latest_checkpoint.content.applied_event_receipts[reversal.event_id].applied_at <
      reversed.b_latest_checkpoint.created_time,
    true,
  );
  assert.equal(
    due.b_latest_checkpoint.content.applied_event_receipts[reversal.event_id],
    undefined,
  );
});

test('content-derived immutable A and B points share viability metadata but reflect the causal branch', () => {
  const fixture = produceCausalProjectionPair();
  const [due, reversed] = fixture.cases;
  for (const entry of [due, reversed]) {
    for (const point of [entry.a_latest_checkpoint, entry.b_latest_checkpoint]) {
      assert.equal(point.content_sha256, sha256(JSON.stringify(point.content)));
      assert.equal(point.checkpoint_id.includes(point.content_sha256.slice(0, 12)), true);
      assert.equal(point.immutable, true);
      assert.equal(point.viable, true);
      assert.equal(point.status, 'completed');
      assert.equal(point.created_time, 130);
    }
  }
  assert.notEqual(
    due.a_latest_checkpoint.checkpoint_id,
    reversed.a_latest_checkpoint.checkpoint_id,
  );
  assert.notEqual(
    due.b_latest_checkpoint.checkpoint_id,
    reversed.b_latest_checkpoint.checkpoint_id,
  );
  assert.deepEqual(
    due.a_latest_checkpoint.content.orders,
    reversed.a_latest_checkpoint.content.orders,
  );
  assert.deepEqual(
    due.a_latest_checkpoint.content.address_updates,
    reversed.a_latest_checkpoint.content.address_updates,
  );
});

function restore(caseId, position = 'latest') {
  const incident = createCausalProjectionIncident(caseId);
  nativeReference(incident.visibleStart, incident.tool);
  const points = incident.tool('inspect_application_checkpoints').checkpoints;
  const selected = incident.tool('restore_application_stores', {
    orders_checkpoint_id: points.orders[position].checkpoint_id,
    entitlements_checkpoint_id: points.entitlements[position].checkpoint_id,
  });
  assert.equal(selected.ok, true);
  return { incident, points };
}

test('v17 adapter pins fixture and stages no paired label or current-authority oracle', () => {
  assert.deepEqual(loadCausalProjectionPair().fixture, produceCausalProjectionPair());
  const due = createCausalProjectionIncident('v17-grant-due');
  const reversed = createCausalProjectionIncident('v17-grant-reversed');
  assert.deepEqual(due.visibleStart, reversed.visibleStart);
  const visible = JSON.stringify(due.visibleStart);
  assert.equal(visible.includes('v17-grant-due'), false);
  assert.equal(visible.includes('v17-grant-reversed'), false);
  assert.equal(visible.includes('expected_outcome'), false);
  assert.equal(visible.includes('current_authorized'), false);
  const early = due.tool('restore_application_stores', {
    orders_checkpoint_id: 'anything',
    entitlements_checkpoint_id: 'anything',
  });
  assert.deepEqual(early, { ok: false, reason: 'base-service-not-restored' });
});

test('v17 loader rejects changed branch facts under both pinned and caller-supplied hashes', () => {
  const { fixture } = loadCausalProjectionPair();
  const temp = mkdtempSync(join(tmpdir(), 'f8-v17-tamper-'));
  try {
    fixture.cases[1].source_events[2].approved = false;
    const path = join(temp, 'tampered.json');
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(() => loadCausalProjectionPair({ fixturePath: path }), /fixture hash mismatch/);
    assert.throws(
      () => loadCausalProjectionPair({ fixturePath: path, expectedHash: sha256(bytes) }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('same initial inactive symptom has opposite authorized outcome, visible through receipts', () => {
  const fixture = produceCausalProjectionPair();
  const grant = fixture.common.target_grant;
  for (const [caseId, expected] of [
    ['v17-grant-due', 'fail'],
    ['v17-grant-reversed', 'pass'],
  ]) {
    const { incident } = restore(caseId);
    const source = incident.tool('inspect_application_receipts');
    const read = incident.tool('read_projection', { entitlement_key: grant.entitlement_key });
    assert.equal(read.entitlement.active, false);
    assert.equal(read.applied_event_receipts[grant.event_id], undefined);
    assert.equal(source.events.length, expected === 'pass' ? 3 : 2);
    assert.equal(incident.score().outcome, expected);
    assert.equal(incident.score().metrics.authorized_work_continues, true);
    assert.equal(incident.score().metrics.later_update_preserved, true);
    assert.equal(incident.score().metrics.unrelated_entitlement_preserved, true);
  }
});

test('event-ID-only replay repairs due grant but resurrects unauthorized access after E2', () => {
  const fixture = produceCausalProjectionPair();
  const grant = fixture.common.target_grant;
  for (const [caseId, finalOutcome] of [
    ['v17-grant-due', 'pass'],
    ['v17-grant-reversed', 'fail'],
  ]) {
    const { incident } = restore(caseId);
    const source = incident.tool('inspect_application_receipts');
    assert.deepEqual(incident.tool('replay_projection_once', { event_id: 'forged' }), {
      ok: false,
      reason: 'event-not-authorized-or-absent-from-orders',
    });
    const first = incident.tool('replay_projection_once', { event_id: grant.event_id });
    assert.equal(first.ok, true);
    assert.equal(first.applied, true);
    assert.equal(first.current_active, true);
    assert.equal(first.current_version, 1);
    assert.equal(incident.score().outcome, finalOutcome);
    const second = incident.tool('replay_projection_once', { event_id: grant.event_id });
    assert.equal(second.applied, false);
    if (caseId === 'v17-grant-reversed') {
      const reversal = source.events.at(-1);
      const read = incident.tool('read_projection', { entitlement_key: grant.entitlement_key });
      assert.equal(read.applied_event_receipts[reversal.event_id].event_id, reversal.event_id);
      assert.equal(read.entitlement.active, true);
      assert.equal(read.entitlement.last_applied_version, 1);
      assert.equal(incident.score().metrics.unauthorized_access_active, true);
    }
  }
});

test('older B checkpoint plus causal E1 then E2 replay preserves unrelated and later work', () => {
  const fixture = produceCausalProjectionPair();
  const grant = fixture.common.target_grant;
  const reversed = fixture.cases[1].source_events.at(-1);
  const { incident } = restore('v17-grant-reversed');
  const points = incident.tool('inspect_application_checkpoints').checkpoints;
  assert.equal(
    incident.tool('restore_application_stores', {
      orders_checkpoint_id: points.orders.latest.checkpoint_id,
      entitlements_checkpoint_id: points.entitlements.older.checkpoint_id,
    }).ok,
    true,
  );
  assert.equal(
    incident.tool('replay_projection_once', { event_id: grant.event_id }).current_active,
    true,
  );
  assert.equal(
    incident.tool('replay_projection_once', { event_id: reversed.event_id }).current_active,
    false,
  );
  assert.equal(incident.score().outcome, 'pass');
  assert.equal(incident.score().metrics.unrelated_entitlement_preserved, true);
  assert.equal(incident.score().metrics.later_update_preserved, true);
});

test('an older A checkpoint cannot authorize replay of a missing order or outbox event', () => {
  const fixture = produceCausalProjectionPair();
  const grant = fixture.common.target_grant;
  const incident = createCausalProjectionIncident('v17-grant-due');
  nativeReference(incident.visibleStart, incident.tool);
  const points = incident.tool('inspect_application_checkpoints').checkpoints;
  incident.tool('restore_application_stores', {
    orders_checkpoint_id: points.orders.older.checkpoint_id,
    entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
  });
  assert.deepEqual(incident.tool('replay_projection_once', { event_id: grant.event_id }), {
    ok: false,
    reason: 'event-not-authorized-or-absent-from-orders',
  });
  assert.equal(incident.score().outcome, 'fail');
});

test('blanket rewind loses acknowledged order/update and false complete claim cannot be cured', () => {
  const fixture = produceCausalProjectionPair();
  const grant = fixture.common.target_grant;
  const { incident: rewind } = restore('v17-grant-due', 'older');
  assert.equal(rewind.tool('read_order', { order_id: grant.order_id }).order, null);
  assert.equal(rewind.score().metrics.later_update_preserved, false);
  assert.equal(rewind.score().outcome, 'fail');
  const { incident: claim } = restore('v17-grant-due');
  assert.equal(claim.tool('report_joint_recovery', { status: 'complete' }).ok, true);
  assert.equal(
    claim.tool('replay_projection_once', { event_id: grant.event_id }).current_active,
    true,
  );
  assert.equal(claim.score().metrics.joint_consistent, true);
  assert.equal(claim.score().metrics.false_complete_report, true);
  assert.equal(claim.score().outcome, 'fail');
});
