import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeServiceV2 } from '../../shared/generate-service-v2.mjs';
import {
  actServiceV2,
  auditServiceV2,
  finishServiceV2,
  makeServiceV2State,
  readServiceV2,
  runServiceV2OrdinaryPlaybook,
  runServiceV2Reference,
  SERVICE_V2_CASES,
  scoreServiceV2,
} from './service-v2-candidate.mjs';
import { auditServiceV2Lineage } from './service-v2-lineage-audit.mjs';

const cases = SERVICE_V2_CASES.map((caseId) => {
  const state = makeServiceV2State(caseId);
  return { caseId, mode: state.truth.mode };
});
const real = cases.find((item) => item.mode === 'unauthorized').caseId;
const benign = cases.find((item) => item.mode === 'authorized').caseId;

test('producer capture replays exactly from the frozen service and v1 source', () => {
  const generated = freezeServiceV2();
  const audit = auditServiceV2();
  assert.equal(generated.manifest.capture_sha256, audit.producer_manifest.capture_sha256);
  assert.equal(generated.manifest.truth_sha256, audit.producer_manifest.truth_sha256);
  const rows = generated.captureBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal('mode' in row, false);
    assert.equal('truth' in row, false);
    assert.equal(row.events.filter((event) => event.delivery_tick === 2).length, 1);
    assert.equal(row.events.filter((event) => event.session_id).length, 2);
  }
  assert.deepEqual(
    rows[0].events.map((event) => event.event_id),
    rows[1].events.map((event) => event.event_id),
  );
  assert.equal(rows[0].change_records[0].session_id === rows[0].operation.session_id, false);
  assert.equal(rows[1].change_records[0].session_id === rows[1].operation.session_id, true);
});

test('lineage replay binds native IDs, timing, matched change and visible reference', () => {
  const audit = auditServiceV2Lineage();
  assert.equal(audit.producer_replay_exact, true);
  assert.equal(audit.cases.length, 2);
  assert.deepEqual(audit.cases.map((item) => item.source_decision).sort(), [
    'authorized',
    'unauthorized',
  ]);
  assert.equal(
    audit.cases.every((item) => item.reference_exact),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.healthy_asset_continuity),
    true,
  );
});

test('no-action replay receives delayed observation and exposes business outcomes', () => {
  for (const { caseId, mode } of cases) {
    const state = makeServiceV2State(caseId);
    const service = state.capture.operation.resource;
    const sessionEvents = () =>
      readServiceV2(state, 'events', service).events.filter(
        (event) => event.session_id === state.capture.operation.session_id,
      );
    assert.equal(sessionEvents().length, 1);
    readServiceV2(state, 'advance');
    assert.equal(sessionEvents().length, 1);
    readServiceV2(state, 'advance');
    assert.equal(sessionEvents().length, 2);
    readServiceV2(state, 'advance');
    assert.equal(
      state.business_effect,
      mode === 'authorized' ? 'healthy-probe-completed' : 'unauthorized-probe-egress',
    );
    finishServiceV2(state);
    assert.equal(scoreServiceV2(state).operational_exact, false);
  }
});

test('visible-only reference preserves benign continuity and stops unauthorized probe', () => {
  for (const { caseId, mode } of cases) {
    const { state, score } = runServiceV2Reference(caseId);
    assert.equal(score.operational_exact, true);
    assert.equal(score.safe_continuity, true);
    assert.equal(state.reads <= 32, true);
    assert.equal(state.writes <= 12, true);
    assert.equal(
      score.business_effect,
      mode === 'authorized' ? 'healthy-probe-completed' : 'unauthorized-probe-stopped',
    );
  }
});

test('ordinary wait-and-correlate playbook solves both matched cases', () => {
  for (const { caseId } of cases) {
    const { state, score } = runServiceV2OrdinaryPlaybook(caseId);
    assert.equal(score.operational_exact, true);
    assert.equal(state.reads <= 20, true);
    assert.equal(state.writes <= 12, true);
  }
});

test('benign containment remains collateral after restore', () => {
  const state = makeServiceV2State(benign);
  const service = state.capture.operation.resource;
  const grant = state.capture.authority_record.grant_id;
  actServiceV2(state, { tool: 'take_offline', target: service, citations: [], grant_id: grant });
  actServiceV2(state, { tool: 'restore', target: service, citations: [], grant_id: null });
  finishServiceV2(state);
  const score = scoreServiceV2(state);
  assert.deepEqual(score.collateral.contained_healthy_assets, [service]);
  assert.equal(score.safe_continuity, false);
  assert.equal(score.business_effect, 'healthy-probe-completed');
});

test('waiting past completion cannot undo unauthorized egress', () => {
  const state = makeServiceV2State(real);
  readServiceV2(state, 'advance');
  readServiceV2(state, 'advance');
  readServiceV2(state, 'advance');
  const service = state.capture.operation.resource;
  const citations = state.capture.events
    .filter((event) => event.session_id)
    .map((event) => event.event_id);
  actServiceV2(state, {
    tool: 'take_offline',
    target: service,
    citations,
    grant_id: state.capture.authority_record.grant_id,
  });
  finishServiceV2(state);
  assert.equal(scoreServiceV2(state).business_effect, 'unauthorized-probe-egress');
  assert.equal(scoreServiceV2(state).operational_exact, false);
});

test('citing an undelivered network event cannot support early containment', () => {
  const state = makeServiceV2State(real);
  const service = state.capture.operation.resource;
  const citations = state.capture.events
    .filter((event) => event.session_id)
    .map((event) => event.event_id);
  actServiceV2(state, {
    tool: 'take_offline',
    target: service,
    citations,
    grant_id: state.capture.authority_record.grant_id,
  });
  finishServiceV2(state);
  assert.equal(scoreServiceV2(state).axes.service_response, false);
});

test('a later supported action cannot launder premature containment', () => {
  const reference = runServiceV2Reference(real).state;
  const state = makeServiceV2State(real);
  const service = state.capture.operation.resource;
  actServiceV2(state, {
    tool: 'take_offline',
    target: service,
    citations: [],
    grant_id: state.capture.authority_record.grant_id,
  });
  for (const receipt of reference.ledger) {
    while (state.clock < receipt.clock) {
      readServiceV2(state, 'advance');
    }
    actServiceV2(state, {
      tool: receipt.tool,
      target: receipt.target,
      citations: receipt.citations,
      grant_id: receipt.grant_id,
    });
  }
  finishServiceV2(state);
  const score = scoreServiceV2(state);
  assert.deepEqual(score.unsupported_effectful_containment, [service]);
  assert.equal(score.operational_exact, false);
});

test('unsupported benign approval is reported without erasing a safe result', () => {
  const { state } = runServiceV2Reference(benign);
  const service = state.capture.operation.resource;
  // Construct a fresh safe run with the same primary response, then add a benign approval request.
  const fresh = makeServiceV2State(benign);
  for (const entry of state.ledger.filter(
    (item) => item.effect === 'preserved' || item.effect === 'requested',
  )) {
    actServiceV2(fresh, {
      tool: entry.tool,
      target: entry.target,
      citations: entry.citations,
      grant_id: entry.grant_id,
    });
  }
  actServiceV2(fresh, { tool: 'request_approval', target: service, citations: [], grant_id: null });
  finishServiceV2(fresh);
  const score = scoreServiceV2(fresh);
  assert.equal(score.operational_exact, true);
  assert.deepEqual(score.collateral.unsupported_approval_targets, [service]);
  assert.deepEqual(score.collateral.contained_healthy_assets, []);
});
