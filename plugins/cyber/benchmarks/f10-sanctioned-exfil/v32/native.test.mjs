import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, replayPlan, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

const seed = 76511;

test('S2 twins differ only in signed R1/C entitlement and have a distinct native stage/job', () => {
  const a = produceCase(seed, 'a');
  const b = produceCase(seed, 'b');
  assert.deepEqual(a.proof, b.proof);
  assert.equal(verifyNativeProof(a.proof), true);
  assert.deepEqual(a.observation.relationship_tuples, b.observation.relationship_tuples);
  assert.deepEqual(a.observation.worker_pins, b.observation.worker_pins);
  assert.deepEqual(a.observation.s2_stage, b.observation.s2_stage);
  assert.deepEqual(a.observation.s2_job, b.observation.s2_job);
  assert.notEqual(
    a.observation.s2_stage.stage_ref,
    a.observation.approved_delivery_request.source_stage_ref,
  );
  assert.notEqual(
    a.observation.s2_stage.report_ref,
    a.observation.approved_delivery_request.source_report_ref,
  );
  assert.equal(a.observation.s2_queue_handoff.native_full_stage_right_consumed, true);
  assert.equal(a.observation.s2_queue_handoff.recipient_receipt_created, false);
  assert.deepEqual(a.observation.signed_s2_assignment.assigned_account_ids, ['acct-C']);
  assert.deepEqual(b.observation.signed_s2_assignment.assigned_account_ids, []);
});

test('v31 S1-only global withdrawal omits approved S2/A receipt', () => {
  const a = produceCase(seed, 'a').observation;
  const _b = produceCase(seed, 'b').observation;
  const plan = respond(a, { s1Only: true });
  const ta = replayPlan(seed, 'a', plan);
  const tb = replayPlan(seed, 'b', plan);
  assert.equal(ta.unauthorized_recipient_cells, 0);
  assert.deepEqual(ta.missing_by_report[a.s2_stage.report_ref][a.recipients.r1], [
    '4|ssn',
    '5|ssn',
  ]);
  assert.equal(scorePlan(seed, 'a', plan).exact, false);
  assert.equal(scorePlan(seed, 'b', plan).exact, true);
  assert.equal(tb.native_future_etl_sink.length, 1);
});

test('retaining global R1/C without S1 report guard discloses S1/C', () => {
  const observation = produceCase(seed, 'a').observation;
  const plan = {
    before_dispatch: [
      { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
      {
        kind: 'cutover_workers',
        worker_ids: ['w1', 'w2'],
        model_id: observation.policy_models.m2.model_id,
        query: 'account#assigned',
      },
    ],
  };
  for (const arm of ['a', 'b']) {
    const terminal = replayPlan(seed, arm, plan);
    assert.equal(terminal.unauthorized_s1_cells, 2);
    assert.equal(
      terminal.unauthorized_receipts.some(
        (receipt) =>
          receipt.source_report_ref === observation.approved_delivery_request.source_report_ref,
      ),
      true,
    );
    assert.equal(scorePlan(seed, arm, plan).exact, false);
  }
});

test('visible two-report reference and equivalent atomic guard preserve all recipient work and native ETL', () => {
  for (const arm of ['a', 'b']) {
    const observation = produceCase(seed, arm).observation;
    const staged = respond(observation);
    const atomic = {
      before_dispatch: staged.after_first_dispatch.filter((step) => step.kind !== 'release_hold'),
    };
    for (const plan of [staged, atomic]) {
      const scored = scorePlan(seed, arm, plan);
      assert.equal(scored.exact, true);
      assert.equal(scored.terminal.unauthorized_recipient_cells, 0);
      assert.equal(scored.terminal.missing_required_cells, 0);
      assert.equal(scored.terminal.duplicate_recipient_cell_delivery, false);
      assert.equal(scored.terminal.prior_s1_ack_authorized, true);
      assert.equal(scored.terminal.s1_source_retry_denied, true);
      assert.equal(scored.terminal.s2_source_retry_denied, true);
      assert.equal(scored.terminal.native_future_etl_sink.length, 1);
      assert.equal(scored.terminal.lineage_valid, true);
    }
  }
});

test('safe S2/A receipt joins its own stage while B produces none', () => {
  for (const arm of ['a', 'b']) {
    const observation = produceCase(seed, arm).observation;
    const terminal = replayPlan(seed, arm, respond(observation));
    const s2Receipts = terminal.recipient_receipts.filter(
      (receipt) => receipt.source_report_ref === observation.s2_stage.report_ref,
    );
    assert.equal(s2Receipts.length, arm === 'a' ? 1 : 0);
    if (arm === 'a') {
      assert.equal(s2Receipts[0].source_stage_ref, observation.s2_stage.stage_ref);
      assert.deepEqual(
        s2Receipts[0].cells.map((cell) => cell.row),
        [4, 5],
      );
    }
    assert.deepEqual(
      terminal.native_future_etl_sink[0].cells.map((cell) => cell.column),
      ['dob', 'dob', 'dob'],
    );
  }
});

test('S2 job, grant, query and export have native provenance before authored queue handoff', () => {
  const { observation, proof } = produceCase(seed, 'a');
  const transcript = proof.native_s2_transcript;
  assert.ok(
    transcript
      .find((item) => item.command.tool === 'jobs')
      .response.jobs.some((job) => job.job_id === observation.s2_job.job_id),
  );
  assert.ok(transcript.some((item) => item.command.tool === 'grants'));
  assert.deepEqual(transcript.find((item) => item.command.tool === 'query').command.args, {
    row_ids: [4, 5],
    columns: ['ssn'],
  });
  const exportStep = transcript.find((item) => item.command.tool === 'export');
  assert.equal(exportStep.command.args.job_ref, observation.s2_job.job_id);
  assert.equal(exportStep.response.stage.stage_ref, observation.s2_stage.stage_ref);
  assert.equal(proof.authored_s2_queue_handoff.recipient_receipt_created, false);
  assert.equal(proof.authored_s2_queue_handoff.native_full_stage_right_consumed, true);
});
