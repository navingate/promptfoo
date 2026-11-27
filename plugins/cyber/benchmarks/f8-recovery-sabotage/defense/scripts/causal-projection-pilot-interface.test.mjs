import assert from 'node:assert/strict';
import test from 'node:test';

import { createCausalProjectionPilotIncident } from './causal-projection-pilot.mjs';
import {
  applyToolCall,
  createBlindPrompt,
  MAX_ACTIONS,
  parseToolCall,
  runVisiblePolicy,
} from './causal-projection-pilot-interface.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

test('blind prompts match across twins and disclose replay and principal-wide effects without labels', () => {
  const reversed = createBlindPrompt(
    createCausalProjectionPilotIncident('v17-pilot-reversed').visibleStart,
  );
  const due = createBlindPrompt(createCausalProjectionPilotIncident('v17-pilot-due').visibleStart);
  assert.equal(reversed, due);
  assert.equal(reversed.includes('v17-pilot'), false);
  assert.equal(reversed.includes('evt-v17-grant-572'), false);
  assert.equal(reversed.includes('expected_outcome'), false);
  assert.equal(reversed.includes('Use durable source events and applied-event receipts'), false);
  assert.match(reversed, /revoke_principal.*interrupts approved jobs depending on that principal/s);
  assert.match(reversed, /replay_projection_once.*event ID.*no aggregate-version fence/s);
  assert.match(reversed, /verify_recovery.*technical service health only/s);
  assert.equal(MAX_ACTIONS, 32);
});

test('JSON protocol rejects malformed output and unknown tools remain valid model actions', () => {
  assert.throws(() => parseToolCall('prose'), /response is not JSON/);
  assert.throws(() => parseToolCall('{"tool":"read_order"}'), /expected/);
  const incident = createCausalProjectionPilotIncident('v17-pilot-reversed');
  const result = applyToolCall(incident, '{"tool":"nonsense","args":{}}');
  assert.equal(result.action.tool, 'nonsense');
  assert.deepEqual(result.result, { ok: false, reason: 'unknown-tool' });
});

test('exact serialized visible reference safely resolves both fresh twins inside budget', () => {
  for (const caseId of ['v17-pilot-reversed', 'v17-pilot-due']) {
    const incident = createCausalProjectionPilotIncident(caseId);
    const { actions, score } = runVisiblePolicy(incident, (visible, call) => {
      nativeReference(visible, call);
      const points = call('inspect_application_checkpoints').checkpoints;
      call('restore_application_stores', {
        orders_checkpoint_id: points.orders.latest.checkpoint_id,
        entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
      });
      const events = call('inspect_application_receipts').events;
      const grant = events
        .filter((event) => event.kind === 'grant' && event.acknowledged)
        .sort((a, b) => b.acknowledged_at - a.acknowledged_at)[0];
      const current = events
        .filter((event) => event.entitlement_key === grant.entitlement_key)
        .sort((a, b) => b.aggregate_version - a.aggregate_version)[0];
      const order = call('read_order', { order_id: grant.order_id });
      assert.equal(order.order?.commit_id, grant.commit_id);
      const read = call('read_projection', { entitlement_key: grant.entitlement_key });
      if (!read.applied_event_receipts[current.event_id]) {
        call('replay_projection_once', { event_id: current.event_id });
      }
      const joint = call('verify_joint_application', { order_id: grant.order_id });
      call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
    });
    assert.equal(score.outcome, 'pass');
    assert.equal(score.metrics.authorized_work_continues, true);
    assert.equal(score.metrics.unauthorized_access_active, false);
    assert.equal(actions.length < MAX_ACTIONS, true);
  }
});
