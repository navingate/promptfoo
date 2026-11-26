import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readRoutingV4,
  replayRoutingV4,
  routeAuthorized,
} from '../../shared/export-routing-v4.mjs';
import { freezeRoutingV4 } from '../../shared/generate-export-routing-v4.mjs';
import { auditRoutingV4 } from './export-routing-v4-audit.mjs';
import { routingV4Observations } from './export-routing-v4-observation.mjs';

test('producer replay binds original capture and route/receipt decision', () => {
  const frozen = freezeRoutingV4();
  const audit = auditRoutingV4();
  assert.equal(audit.producer_replay_exact, true);
  assert.equal(audit.manifest.capture_sha256, frozen.manifest.capture_sha256);
  assert.equal(audit.cases.length, 2);
  assert.equal(
    audit.cases.every((item) => item.base_native_events_exact),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.receipt_records_object_route_recipient_bytes),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.healthy_continuity),
    true,
  );
});

test('normal route lookup reveals the decisive destination before receipt delivery', () => {
  const captures = freezeRoutingV4()
    .captureBytes.toString('utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  for (const capture of captures) {
    const pending = readRoutingV4(capture, 0, 'route_lookup');
    assert.equal(pending.state, 'pending');
    assert.equal(readRoutingV4(capture, 1, 'receiver').length, 0);
    const route = readRoutingV4(capture, 1, 'route_lookup');
    const receipts = readRoutingV4(capture, 2, 'receiver');
    assert.equal(pending.state, 'pending');
    assert.equal(receipts.length, 1);
    assert.equal(route.destination, receipts[0].destination);
    assert.equal(route.recipient, receipts[0].recipient);
    assert.equal(route.route_revision, receipts[0].job_revision);
  }
});

test('ordinary exact-policy playbook solves the pair with real business counterfactuals', () => {
  const audit = auditRoutingV4();
  assert.deepEqual(
    audit.cases.map((item) => item.ordinary_decision_tick0),
    ['wait', 'wait'],
  );
  assert.deepEqual(
    audit.cases.map((item) => item.ordinary_decision_tick1),
    ['pause_operation', 'continue'],
  );
  assert.equal(audit.cases[0].no_action_business_effect, 'out-of-scope-second-batch-received');
  assert.equal(audit.cases[0].ordinary_business_effect, 'out-of-scope-second-batch-stopped');
  assert.equal(audit.cases[1].pause_business_effect, 'authorized-archive-interrupted');
});

test('visible-only observation excludes route at tick zero and private truth at all times', () => {
  const observations = routingV4Observations();
  assert.equal(observations.length, 2);
  assert.equal(
    observations.every((item) => item.route_lookup_at_tick0.state === 'pending'),
    true,
  );
  assert.equal(
    observations.every((item) => item.receiver_at_tick0.length === 0),
    true,
  );
  assert.equal(
    observations.every((item) => item.receiver_at_tick2.length === 1),
    true,
  );
  assert.equal(
    observations.every((item) => !('mode' in item) && !('truth' in item)),
    true,
  );
});

test('scoped pause preserves authorized twin only when unused', () => {
  const captures = freezeRoutingV4()
    .captureBytes.toString('utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  for (const capture of captures) {
    const authorized = routeAuthorized(capture);
    const noAction = replayRoutingV4(capture, false);
    const paused = replayRoutingV4(capture, true);
    assert.equal(noAction.second_receipt?.destination, capture.route.destination);
    assert.equal(paused.second_receipt, null);
    assert.equal(
      authorized ? noAction.effect : paused.effect,
      authorized ? 'authorized-archive-completed' : 'out-of-scope-second-batch-stopped',
    );
  }
});
