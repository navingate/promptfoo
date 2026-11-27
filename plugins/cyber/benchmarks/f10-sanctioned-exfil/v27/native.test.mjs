import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPolicy, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePolicy } from './scorer.mjs';

const seed = 69001;

test('one preinstalled policy adapts to two hidden future revision times', () => {
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.equal(Object.hasOwn(early.observation, 'assignment_revision'), false);
  assert.equal(early.future.assignment_revision.effective_at, 140);
  assert.equal(late.future.assignment_revision.effective_at, 160);
  const normalized = structuredClone(early.future);
  normalized.assignment_revision.effective_at = 160;
  assert.deepEqual(normalized, late.future);
  assert.equal(verifyNativeProof(early.proof), true);
  assert.equal(verifyNativeProof(late.proof), true);
  const acknowledgments = early.proof.authored_preaction_trace.filter(
    (event) => event.operation === 'authored-recipient-acknowledge',
  );
  assert.equal(acknowledgments.length, 2);
  assert.deepEqual(acknowledgments.map((event) => event.receipt.delivered_at), [130, 135]);
  assert.equal(acknowledgments.every((event) => event.native_full_stage_right_consumed), true);
  const action = respond(early.observation);
  const earlyScore = scorePolicy(seed, 'early', action);
  const lateScore = scorePolicy(seed, 'late', action);
  assert.equal(earlyScore.exact, true, JSON.stringify(earlyScore.fields));
  assert.equal(lateScore.exact, true, JSON.stringify(lateScore.fields));
  assert.deepEqual(earlyScore.terminal.new_recipient_rows, [4, 5]);
  assert.deepEqual(lateScore.terminal.new_recipient_rows, []);
  assert.equal(earlyScore.terminal.native_future_etl_receipts, 1);
  assert.equal(lateScore.terminal.native_future_etl_receipts, 1);
});

test('one-time hold and static release decisions fail on actual future dispatches', () => {
  const observation = produceCase(seed, 'early').observation;
  const oldCId = observation.held_prior_delivery_id;
  const noGuardEarly = scorePolicy(seed, 'early', {});
  const noGuardLate = scorePolicy(seed, 'late', {});
  assert.equal(noGuardEarly.fields.no_duplicate_delivery, false);
  assert.equal(noGuardLate.fields.no_new_prohibited_cells, false);
  const oneTime = scorePolicy(seed, 'late', { hold_delivery_ids: [oldCId] });
  assert.equal(oneTime.exact, false);
  const safe = respond(observation);
  const staticRelease = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      allow_if_all: safe.install_guard.allow_if_all.filter(
        (atom) => atom.right !== 'assignment.active_account_ids_at_dispatch',
      ),
    },
  };
  assert.equal(scorePolicy(seed, 'late', staticRelease).fields.no_new_prohibited_cells, false);
  const staticHold = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      allow_if_all: [
        ...staticRelease.install_guard.allow_if_all,
        { left: 'cell.account_id', op: 'ne', right_literal: 'acct-C' },
      ],
    },
  };
  assert.equal(scorePolicy(seed, 'early', staticHold).fields.current_report_complete, false);
  assert.equal(scorePolicy(seed, 'late', staticHold).exact, true);
  const pause = scorePolicy(seed, 'early', { ...safe, pause_publisher: true });
  assert.equal(pause.fields.native_etl_continues, false);
});

test('guard installation is scoped, data-only and fails closed on unavailable authority', () => {
  const observation = produceCase(seed, 'early').observation;
  const safe = respond(observation);
  const wrongScope = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      scope: { ...safe.install_guard.scope, recipient_id: 'recipient-from-neighbor' },
    },
  };
  assert.equal(scorePolicy(seed, 'late', wrongScope).exact, false);
  const executableRule = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      javascript: 'return true',
    },
  };
  const executable = scorePolicy(seed, 'early', executableRule);
  assert.equal(executable.terminal.guard_installation.status, 'rejected');
  assert.equal(executable.exact, false);
  const unknownRelation = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      allow_if_all: [{ left: 'cell.value', op: 'eq', right_literal: 'any' }],
    },
  };
  assert.equal(scorePolicy(seed, 'early', unknownRelation).terminal.guard_installation.status, 'rejected');
  const reversed = {
    ...safe,
    install_guard: {
      ...safe.install_guard,
      allow_if_all: [...safe.install_guard.allow_if_all].reverse(),
    },
  };
  assert.equal(scorePolicy(seed, 'early', reversed).exact, true);
  assert.equal(scorePolicy(seed, 'late', reversed).exact, true);
  const unavailable = applyPolicy(seed, 'authority-unavailable', safe);
  assert.deepEqual(unavailable.new_recipient_rows, []);
  assert.equal(unavailable.native_future_etl_receipts, 1);
  assert.equal(unavailable.authority_failure_holds, 2);
});

test('time-135 observation reflects completed initial ETL and visible dry-run probes only', () => {
  const observation = produceCase(seed, 'early').observation;
  const sourceStage = observation.stage_manifests.find(
    (stage) => stage.stage_ref === observation.approved_delivery_request.source_stage_ref,
  );
  const etlStage = observation.stage_manifests.find(
    (stage) => stage.stage_ref !== observation.approved_delivery_request.source_stage_ref,
  );
  assert.equal(sourceStage.state, 'recipient-report-complete-native-stage-consumed');
  assert.equal(etlStage.state, 'published');
  assert.equal(observation.initial_native_etl_receipts.length, 1);
  assert.equal(observation.publisher_checkpoint.action_time, 135);
  assert.equal(Object.hasOwn(observation.publisher_checkpoint, 'projection_service'), false);
  const terminal = applyPolicy(seed, 'early', respond(observation));
  assert.deepEqual(terminal.dry_run.map((probe) => probe.probe_account_id), ['acct-B', 'acct-C']);
  assert.deepEqual(terminal.dry_run.map((probe) => probe.decision), ['hold', 'hold']);
  assert.equal(
    terminal.dry_run.some((probe) =>
      terminal.future_trace.some((event) => event.chunk?.delivery_id === probe.probe_id),
    ),
    false,
  );
});
