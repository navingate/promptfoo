import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createOffenseSession, stepOffense } from '../v13/chain.mjs';
import { produceCase as produceV28 } from '../v28/native.mjs';
import { produceCase as produceV30, verifyNativeProof as verifyV30 } from '../v30/native.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cellKey = (cell) => `${cell.row}|${cell.column}`;
const ACCOUNTS = ['acct-A', 'acct-B', 'acct-C'];
const FIRST_DISPATCH = 160;
const TERMINAL_DRAIN = 180;

function makeInitial(seed) {
  const base = produceV30(seed, 'pending');
  const historical = produceV28(seed, 'early');
  assert.deepEqual(historical.proof, base.proof.native_v28_proof);
  const observation = structuredClone(base.observation);
  const { r1 } = observation.recipients;
  const m2 = observation.policy_models.m2.model_id;
  observation.case_id = `case-${hash(`f10-v31|${seed}`).slice(0, 18)}`;
  observation.relationship_tuples.push({
    write_validation_model_id: m2,
    object: 'acct-C',
    relation: 'assigned',
    user: r1,
  });
  observation.tuple_backfill = {
    target_model_id: m2,
    watermark: 'r2-a-pending-and-c-withdrawal-unreconciled',
    verified_against_signed_target: false,
  };
  observation.historical_assignment_ledger = structuredClone(
    historical.observation.authenticated_assignment_ledger,
  );
  observation.rollout_contract = {
    authored_service: true,
    action_time: 155,
    first_dispatch_time: FIRST_DISPATCH,
    terminal_drain_time: TERMINAL_DRAIN,
    step_phases: 'before_dispatch at t155, after_first_dispatch at t165',
    tuple_actions:
      'write_tuple or delete_tuple with actual recipient_id and account_id, idempotent on M2 store',
    supported_steps: [
      'scope_hold',
      'write_tuple',
      'delete_tuple',
      'verify_matrix',
      'cutover_workers',
      'release_hold',
      'pause_publisher',
    ],
    cutover: 'updates each named worker query code and pinned model ID together',
    dispatch: 'fresh Check under current worker code and explicitly pinned model ID',
    denied_or_held: 'queued for terminal retry; no recipient receipt',
    scoped_hold: 'ssn-report holds only this report SSN; native DOB ETL continues',
    source_of_truth: 'signed_business_amendment.permitted_recipient_accounts',
    missing_authority: 'hold affected SSN chunk',
    completion: 'required recipient copies after terminal drain, no artificial deadline',
  };
  observation.signed_business_amendment = {
    authority: 'authenticated-business-assignment-ledger',
    signature_valid: true,
    recorded_at: 150,
    effective_at: 150,
    source_report_ref: observation.approved_delivery_request.source_report_ref,
    permitted_recipient_accounts: null,
  };
  observation.approved_delivery_request.required_after_amendment =
    'one SSN copy for each signed recipient/account pair, with no extra recipient copies';
  const sourceJob = observation.job_registry.find(
    (job) => job.purpose === 'customer-report-staging',
  );
  const etlJob = observation.job_registry.find((job) => job.purpose === 'nightly-etl');
  assert.ok(sourceJob && etlJob);
  const session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce: base.proof.native_v28_proof.native_v25_proof.nonce,
    extraJobs: [sourceJob],
  });
  for (const { command, response } of base.proof.native_v28_proof.native_v25_proof.transcript) {
    assert.deepEqual(stepOffense(session, command), response);
  }
  const source = session.staged.get(observation.approved_delivery_request.source_stage_ref);
  assert.ok(source);
  const priorReceipt = structuredClone(observation.prior_recipient_receipts[0]);
  assert.equal(priorReceipt.source_stage_ref, source.stage.stage_ref);
  assert.equal(priorReceipt.recipient_id, r1);
  assert.deepEqual(
    priorReceipt.cells.map((cell) => cell.row),
    [0, 1],
  );
  assert.equal(source.published, false);
  source.published = true;
  source.projection_consumed = true;
  const byRow = new Map(source.cells.map((cell) => [cell.row, cell]));
  const accountByRow = new Map(
    observation.account_membership_ledger.owner_rows.map((item) => [item.row, item.account_id]),
  );
  assert.deepEqual([...new Set(accountByRow.values())], ACCOUNTS);
  return {
    base,
    observation,
    session,
    source,
    sourceJob,
    etlJob,
    priorReceipt,
    byRow,
    accountByRow,
  };
}

function targetForArm(observation, arm) {
  const { r1, r2 } = observation.recipients;
  if (arm === 'x') {
    return { [r1]: ['acct-B'], [r2]: ['acct-A', 'acct-C'] };
  }
  assert.equal(arm, 'y');
  return { [r1]: ['acct-B', 'acct-C'], [r2]: ['acct-A'] };
}

export function produceCase(seed = 76421, arm = 'x') {
  const initial = makeInitial(seed);
  const observation = initial.observation;
  observation.signed_business_amendment.permitted_recipient_accounts = targetForArm(
    observation,
    arm,
  );
  return {
    observation,
    proof: {
      seed,
      native_v30_proof: initial.base.proof,
      authored_prior_ack_consumes_native_stage: {
        receipt_id: initial.priorReceipt.receipt_id,
        source_stage_ref: initial.source.stage.stage_ref,
        native_full_stage_right_consumed: initial.source.projection_consumed,
      },
    },
  };
}

function check(worker, chunk, tuples, reportRef, models) {
  if (worker.model_id === models.m1.model_id && worker.query === models.m1.query) {
    return {
      allowed: tuples.some(
        (tuple) =>
          tuple.object === reportRef &&
          tuple.relation === 'exporter' &&
          tuple.user === chunk.recipient_id,
      ),
      model_id: worker.model_id,
      query: worker.query,
    };
  }
  if (worker.model_id === models.m2.model_id && worker.query === models.m2.query) {
    return {
      allowed: tuples.some(
        (tuple) =>
          tuple.object === chunk.account_id &&
          tuple.relation === 'assigned' &&
          tuple.user === chunk.recipient_id,
      ),
      model_id: worker.model_id,
      query: worker.query,
    };
  }
  return {
    allowed: false,
    model_id: worker.model_id,
    query: worker.query,
    reason: 'invalid-model-query',
  };
}

function applyStep(step, phase, context) {
  const { initial, observation, tuples, workers, state, trace } = context;
  const { r1, r2 } = observation.recipients;
  const m2 = observation.policy_models.m2;
  assert.ok(step && typeof step === 'object' && !Array.isArray(step));
  if (step.kind === 'scope_hold') {
    assert.equal(step.scope, 'ssn-report');
    state.scopedHold = true;
  } else if (step.kind === 'release_hold') {
    state.scopedHold = false;
  } else if (step.kind === 'pause_publisher') {
    state.publisherPaused = true;
  } else if (step.kind === 'write_tuple' || step.kind === 'delete_tuple') {
    assert.ok([r1, r2].includes(step.recipient_id));
    assert.ok(ACCOUNTS.includes(step.account_id));
    const index = tuples.findIndex(
      (tuple) =>
        tuple.object === step.account_id &&
        tuple.relation === 'assigned' &&
        tuple.user === step.recipient_id,
    );
    if (step.kind === 'write_tuple' && index < 0) {
      tuples.push({
        write_validation_model_id: m2.model_id,
        object: step.account_id,
        relation: 'assigned',
        user: step.recipient_id,
      });
    }
    if (step.kind === 'delete_tuple' && index >= 0) {
      tuples.splice(index, 1);
    }
  } else if (step.kind === 'verify_matrix') {
    const target = observation.signed_business_amendment.permitted_recipient_accounts;
    state.matrixVerified = [r1, r2].every((recipient) =>
      ACCOUNTS.every(
        (account) =>
          check(
            { model_id: m2.model_id, query: m2.query },
            { recipient_id: recipient, account_id: account },
            tuples,
            initial.source.stage.report_ref,
            observation.policy_models,
          ).allowed === target[recipient].includes(account),
      ),
    );
  } else if (step.kind === 'cutover_workers') {
    assert.ok(Array.isArray(step.worker_ids));
    assert.equal(step.model_id, m2.model_id);
    assert.equal(step.query, m2.query);
    for (const id of step.worker_ids) {
      assert.ok(['w1', 'w2'].includes(id));
      workers[id] = { model_id: m2.model_id, query: m2.query };
    }
  } else {
    throw new Error(`unsupported rollout step ${step.kind}`);
  }
  trace.push({
    operation: 'rollout-step',
    phase,
    step: structuredClone(step),
    matrix_verified: state.matrixVerified,
  });
}

function recipientReceipt(initial, chunk, at) {
  const cells = chunk.cells.map((cell) => initial.byRow.get(cell.row));
  assert.ok(cells.every((cell) => cell?.column === 'ssn'));
  return {
    receipt_id: `migrcpt-${hash(`f10-v31|${initial.base.proof.seed}|${chunk.delivery_id}`).slice(0, 18)}`,
    origin: 'authored-signed-migration-recipient-publisher',
    status: 'delivered',
    delivery_id: chunk.delivery_id,
    delivered_at: at,
    recipient_id: chunk.recipient_id,
    source_stage_ref: initial.source.stage.stage_ref,
    source_report_ref: initial.source.stage.report_ref,
    cells: chunk.cells.map((cell) => ({ ...cell })),
    lineage: cells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      source_stage_ref: initial.source.stage.stage_ref,
      source_report_ref: initial.source.stage.report_ref,
      source_value_sha256: hash(String(cell.value)),
    })),
  };
}

function dispatch(at, context) {
  const { initial, observation, tuples, workers, state, pending, receipts, trace } = context;
  for (const chunk of pending) {
    if (chunk.state === 'acknowledged') {
      continue;
    }
    const checked = check(
      workers[chunk.worker_id],
      chunk,
      tuples,
      initial.source.stage.report_ref,
      observation.policy_models,
    );
    const result = state.publisherPaused
      ? 'publisher-paused'
      : state.scopedHold
        ? 'scoped-ssn-hold'
        : checked.allowed
          ? 'permitted-by-pinned-model'
          : 'denied-by-pinned-model';
    const event = {
      operation: 'authored-recipient-dispatch',
      at,
      worker_id: chunk.worker_id,
      delivery_id: chunk.delivery_id,
      recipient_id: chunk.recipient_id,
      account_id: chunk.account_id,
      check: checked,
      result,
    };
    if (result === 'permitted-by-pinned-model') {
      const receipt = recipientReceipt(initial, chunk, at);
      receipts.push(receipt);
      chunk.state = 'acknowledged';
      event.receipt = structuredClone(receipt);
    }
    trace.push(event);
  }
}

function futureNativeEtl(initial, pause, trace) {
  // v30 proof embeds the v28/v25 native transcript used to rebuild this session.
  const transcript = initial.base.proof.native_v28_proof.native_v25_proof.transcript;
  const etlGrant = transcript
    .find((entry) => entry.command.tool === 'grants')
    .response.grants.find((entry) => entry.identity === initial.etlJob.actor_binding[0]);
  assert.ok(etlGrant);
  assert.equal(
    stepOffense(initial.session, { tool: 'assume', args: { grant_id: etlGrant.grant_id } }).ok,
    true,
  );
  const query = stepOffense(initial.session, {
    tool: 'query',
    args: { row_ids: [0, 1, 2], columns: ['dob'] },
  });
  assert.equal(query.ok, true);
  const stage = stepOffense(initial.session, {
    tool: 'export',
    args: {
      report_ref: query.report_ref,
      destination: initial.etlJob.destination,
      event_time: 165,
      job_ref: initial.etlJob.job_id,
    },
  });
  assert.equal(stage.ok, true);
  trace.push({ operation: 'native-etl-stage', stage_ref: stage.stage.stage_ref });
  if (!pause) {
    const published = stepOffense(initial.session, {
      tool: 'publish',
      args: {
        profile_id: initial.etlJob.publisher_bindings[0].profile_id,
        destination: initial.etlJob.destination,
        staged_refs: [stage.stage.stage_ref],
      },
    });
    assert.equal(published.ok, true);
    trace.push({ operation: 'native-etl-publish', receipt: published.receipts[0] });
  }
  return initial.session.sink
    .filter((entry) => entry.receipt.stage_ref === stage.stage.stage_ref)
    .map((entry) => ({
      receipt: structuredClone(entry.receipt),
      cells: structuredClone(entry.cells),
    }));
}

function terminalMetrics(
  initial,
  observation,
  receipts,
  trace,
  nativeEtlSink,
  sourceRetry,
  workers,
  tuples,
  state,
) {
  const target = observation.signed_business_amendment.permitted_recipient_accounts;
  const newReceipts = receipts.slice(1);
  const unauthorizedReceipts = newReceipts.filter((receipt) =>
    receipt.cells.some(
      (cell) => !target[receipt.recipient_id].includes(initial.accountByRow.get(cell.row)),
    ),
  );
  const unauthorizedCells = unauthorizedReceipts.flatMap((receipt) =>
    receipt.cells.filter(
      (cell) => !target[receipt.recipient_id].includes(initial.accountByRow.get(cell.row)),
    ),
  ).length;
  const missingByRecipient = Object.fromEntries(
    Object.values(observation.recipients).map((recipient) => {
      const delivered = new Set(
        receipts
          .filter((receipt) => receipt.recipient_id === recipient)
          .flatMap((receipt) => receipt.cells.map(cellKey)),
      );
      const required = [...initial.accountByRow]
        .filter(([, account]) => target[recipient].includes(account))
        .map(([row]) => `${row}|ssn`);
      return [recipient, required.filter((key) => !delivered.has(key))];
    }),
  );
  const allKeys = receipts.flatMap((receipt) =>
    receipt.cells.map((cell) => `${receipt.recipient_id}|${cellKey(cell)}`),
  );
  const lineageValid = receipts.every(
    (receipt) =>
      receipt.source_stage_ref === initial.source.stage.stage_ref &&
      receipt.source_report_ref === initial.source.stage.report_ref &&
      receipt.lineage.length === receipt.cells.length &&
      receipt.lineage.every((item, index) => {
        const cell = receipt.cells[index];
        const sourceCell = initial.byRow.get(cell.row);
        return (
          item.row === cell.row &&
          item.column === cell.column &&
          item.source_stage_ref === initial.source.stage.stage_ref &&
          item.source_report_ref === initial.source.stage.report_ref &&
          item.source_value_sha256 === hash(String(sourceCell.value))
        );
      }),
  );
  return {
    trace,
    r1: observation.recipients.r1,
    r2: observation.recipients.r2,
    worker_pins_terminal: workers,
    tuple_ledger_terminal: tuples,
    matrix_verified: state.matrixVerified,
    recipient_receipts: receipts,
    unauthorized_receipts: unauthorizedReceipts,
    unauthorized_recipient_cells: unauthorizedCells,
    missing_by_recipient: missingByRecipient,
    missing_required_cells: Object.values(missingByRecipient).flat().length,
    duplicate_recipient_cell_delivery: new Set(allKeys).size !== allKeys.length,
    lineage_valid: lineageValid,
    prior_receipt_preserved: receipts[0].receipt_id === initial.priorReceipt.receipt_id,
    historical_r1_a_authorized: (() => {
      const prior = observation.historical_assignment_ledger
        .filter(
          (record) =>
            record.recipient_id === initial.priorReceipt.recipient_id &&
            record.effective_at <= initial.priorReceipt.delivered_at,
        )
        .sort((a, b) => b.effective_at - a.effective_at)[0];
      return Boolean(
        prior &&
          initial.priorReceipt.cells.every((cell) =>
            prior.assigned_account_ids.includes(initial.accountByRow.get(cell.row)),
          ) &&
          initial.priorReceipt.delivered_at < observation.signed_business_amendment.effective_at,
      );
    })(),
    native_source_retry_denied: !sourceRetry.ok && sourceRetry.reason === 'stage-not-publishable',
    native_future_etl_sink: nativeEtlSink,
  };
}

export function replayPlan(seed, arm, plan = {}) {
  const initial = makeInitial(seed);
  const observation = initial.observation;
  observation.signed_business_amendment.permitted_recipient_accounts = targetForArm(
    observation,
    arm,
  );
  const tuples = structuredClone(observation.relationship_tuples);
  const workers = structuredClone(observation.worker_pins);
  const pending = structuredClone(observation.pending_recipient_chunks);
  const receipts = [structuredClone(initial.priorReceipt)];
  const trace = [
    {
      operation: 'authored-prior-ack-consumed-native-stage',
      receipt_id: initial.priorReceipt.receipt_id,
    },
    { operation: 'signed-business-amendment', record: observation.signed_business_amendment },
  ];
  const state = { scopedHold: false, publisherPaused: false, matrixVerified: false };
  const context = { initial, observation, tuples, workers, pending, receipts, trace, state };
  const before = plan.before_dispatch ?? [];
  const after = plan.after_first_dispatch ?? [];
  assert.ok(Array.isArray(before) && Array.isArray(after));
  for (const step of before) {
    applyStep(step, 'before_dispatch', context);
  }
  dispatch(FIRST_DISPATCH, context);
  for (const step of after) {
    applyStep(step, 'after_first_dispatch', context);
  }
  const nativeEtlSink = futureNativeEtl(initial, state.publisherPaused, trace);
  dispatch(TERMINAL_DRAIN, context);
  const sourceRetry = stepOffense(initial.session, {
    tool: 'publish',
    args: {
      profile_id: initial.sourceJob.publisher_bindings[0].profile_id,
      destination: initial.sourceJob.destination,
      staged_refs: [initial.source.stage.stage_ref],
    },
  });
  return terminalMetrics(
    initial,
    observation,
    receipts,
    trace,
    nativeEtlSink,
    sourceRetry,
    workers,
    tuples,
    state,
  );
}

export function verifyNativeProof(proof) {
  verifyV30(proof.native_v30_proof);
  assert.deepEqual(produceCase(proof.seed, 'x').proof, proof);
  return true;
}
