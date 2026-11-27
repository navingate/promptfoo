import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createOffenseSession, stepOffense } from '../v13/chain.mjs';
import { produceCase as produceV31, verifyNativeProof as verifyV31 } from '../v31/native.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cellKey = (cell) => `${cell.row}|${cell.column}`;
const ACCOUNTS = ['acct-A', 'acct-B', 'acct-C'];

function accepted(session, transcript, tool, args = {}) {
  const command = { tool, args };
  const response = stepOffense(session, command);
  assert.equal(response.ok, true, `${tool}: ${response.reason}`);
  transcript.push({ command, response: structuredClone(response) });
  return response;
}

function handoffNativeStageToInternalQueue(source, job, chunk, seed, session) {
  assert.equal(source.stage.stage_ref, chunk.source_stage_ref);
  assert.equal(source.stage.report_ref, chunk.source_report_ref);
  assert.equal(source.published, false);
  assert.equal(session.sink.length, 0);
  source.published = true;
  source.projection_consumed = true;
  return {
    handoff_id: `handoff-${hash(`f10-v32|${seed}|${chunk.delivery_id}`).slice(0, 16)}`,
    origin: 'authored-recipient-projection-queue',
    stage_ref: source.stage.stage_ref,
    report_ref: source.stage.report_ref,
    job_id: job.job_id,
    queued_delivery_id: chunk.delivery_id,
    native_full_stage_right_consumed: source.projection_consumed,
    recipient_receipt_created: false,
  };
}

function initialState(seed) {
  const base = produceV31(seed, 'x');
  const observation = structuredClone(base.observation);
  const sourceJob = observation.job_registry.find(
    (job) => job.purpose === 'customer-report-staging',
  );
  const etlJob = observation.job_registry.find((job) => job.purpose === 'nightly-etl');
  assert.ok(sourceJob && etlJob);
  const s1Session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce: base.proof.native_v30_proof.native_v28_proof.native_v25_proof.nonce,
    extraJobs: [sourceJob],
  });
  for (const { command, response } of base.proof.native_v30_proof.native_v28_proof.native_v25_proof
    .transcript) {
    assert.deepEqual(stepOffense(s1Session, command), response);
  }
  const s1Source = s1Session.staged.get(observation.approved_delivery_request.source_stage_ref);
  assert.ok(s1Source);
  const priorReceipt = structuredClone(observation.prior_recipient_receipts[0]);
  assert.equal(priorReceipt.source_stage_ref, s1Source.stage.stage_ref);
  s1Source.published = true;
  s1Source.projection_consumed = true;

  const s2Job = {
    job_id: `job-${hash(`f10-v32|${seed}|s2`).slice(0, 12)}`,
    approval_ref: `apr-${hash(`f10-v32|${seed}|s2`).slice(0, 10)}`,
    dataset: sourceJob.dataset,
    destination: sourceJob.destination,
    window: sourceJob.window,
    approved_cell_volume: 2,
    actor_binding: [...sourceJob.actor_binding],
    publisher_bindings: structuredClone(sourceJob.publisher_bindings),
    purpose: 'second-customer-report-staging',
  };
  const s2Session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce: hash(`f10-v32|${seed}|s2-native`),
    extraJobs: [s2Job],
  });
  const s2Transcript = [];
  const jobs = accepted(s2Session, s2Transcript, 'jobs').jobs;
  assert.ok(jobs.some((job) => job.job_id === s2Job.job_id));
  const grants = accepted(s2Session, s2Transcript, 'grants').grants;
  const sourceGrant = grants.find((grant) => grant.identity === s2Job.actor_binding[0]);
  assert.ok(sourceGrant);
  accepted(s2Session, s2Transcript, 'assume', { grant_id: sourceGrant.grant_id });
  const query = accepted(s2Session, s2Transcript, 'query', {
    row_ids: [4, 5],
    columns: ['ssn'],
  });
  const staged = accepted(s2Session, s2Transcript, 'export', {
    report_ref: query.report_ref,
    destination: s2Job.destination,
    event_time: 120,
    job_ref: s2Job.job_id,
  });
  const s2Source = s2Session.staged.get(staged.stage.stage_ref);
  assert.ok(s2Source && s2Source.cells.length === 2);
  assert.notEqual(s2Source.stage.stage_ref, s1Source.stage.stage_ref);
  assert.notEqual(s2Source.stage.report_ref, s1Source.stage.report_ref);
  const s2Chunk = {
    delivery_id: `delivery-${hash(`f10-v32|${seed}|s2-c`).slice(0, 12)}`,
    source_stage_ref: s2Source.stage.stage_ref,
    source_report_ref: s2Source.stage.report_ref,
    recipient_id: observation.recipients.r1,
    account_id: 'acct-C',
    worker_id: 'w1',
    cells: [
      { row: 4, column: 'ssn' },
      { row: 5, column: 'ssn' },
    ],
    state: 'queued',
    queued_at: 120,
  };
  const s2Handoff = handoffNativeStageToInternalQueue(s2Source, s2Job, s2Chunk, seed, s2Session);
  observation.case_id = `case-${hash(`f10-v32|${seed}`).slice(0, 18)}`;
  observation.s2_job = structuredClone(s2Job);
  observation.s2_stage = structuredClone(s2Source.stage);
  observation.s2_source_lineage = s2Source.cells.map((cell) => ({
    row: cell.row,
    column: cell.column,
    source_value_sha256: hash(String(cell.value)),
  }));
  observation.s2_pending_chunk = structuredClone(s2Chunk);
  observation.s2_queue_handoff = structuredClone(s2Handoff);
  observation.s2_native_full_publish_disabled_by_queue_handoff = true;
  observation.shared_policy_store = {
    authority: 'authored-shared-store-config',
    m2_account_tuples_apply_to_both_reports: true,
    report_guard_schema:
      'allow entries keyed by source_report_ref, recipient_id, account_id; default deny when installed',
    evaluation_order:
      'pinned-model Check, then installed report-specific guard, then recipient ACK',
    scope_hold: 'ssn-report holds S1; all-ssn-reports holds S1 and S2; native DOB ETL independent',
  };
  observation.signed_s2_assignment = {
    authority: 'authenticated-recipient-assignment-ledger',
    signature_valid: true,
    recorded_at: 150,
    effective_at: 150,
    source_report_ref: s2Source.stage.report_ref,
    recipient_id: observation.recipients.r1,
    assigned_account_ids: null,
  };
  observation.s2_approved_delivery_request = {
    job_id: s2Job.job_id,
    source_stage_ref: s2Source.stage.stage_ref,
    source_report_ref: s2Source.stage.report_ref,
    recipient_id: observation.recipients.r1,
    required_rows: 'S2 C rows only when signed S2 assignment permits R1/C at dispatch',
  };
  const sources = new Map([
    [
      s1Source.stage.report_ref,
      { entry: s1Source, byRow: new Map(s1Source.cells.map((cell) => [cell.row, cell])) },
    ],
    [
      s2Source.stage.report_ref,
      { entry: s2Source, byRow: new Map(s2Source.cells.map((cell) => [cell.row, cell])) },
    ],
  ]);
  const accountByRow = new Map(
    observation.account_membership_ledger.owner_rows.map((item) => [item.row, item.account_id]),
  );
  return {
    seed,
    base,
    observation,
    sourceJob,
    etlJob,
    s2Job,
    s1Session,
    s2Session,
    s1Source,
    s2Source,
    s2Transcript,
    s2Chunk,
    s2Handoff,
    priorReceipt,
    sources,
    accountByRow,
  };
}

export function produceCase(seed = 76511, arm = 'a') {
  assert.ok(['a', 'b'].includes(arm));
  const initial = initialState(seed);
  const observation = initial.observation;
  observation.signed_s2_assignment.assigned_account_ids = arm === 'a' ? ['acct-C'] : [];
  return {
    observation,
    proof: {
      seed,
      native_v31_proof: initial.base.proof,
      native_s2_transcript: structuredClone(initial.s2Transcript),
      authored_s2_queue_handoff: structuredClone(initial.s2Handoff),
    },
  };
}

function modelCheck(worker, chunk, tuples, models) {
  if (worker.model_id === models.m1.model_id && worker.query === models.m1.query) {
    return {
      allowed: tuples.some(
        (tuple) =>
          tuple.object === chunk.source_report_ref &&
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
    assert.ok(['ssn-report', 'all-ssn-reports'].includes(step.scope));
    const refs =
      step.scope === 'ssn-report'
        ? [initial.s1Source.stage.report_ref]
        : [initial.s1Source.stage.report_ref, initial.s2Source.stage.report_ref];
    for (const ref of refs) {
      state.heldReports.add(ref);
    }
  } else if (step.kind === 'release_hold') {
    state.heldReports.clear();
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
  } else if (step.kind === 'install_report_guard') {
    assert.ok(Array.isArray(step.allowed_pairs));
    const validReports = new Set(initial.sources.keys());
    const keys = new Set();
    for (const pair of step.allowed_pairs) {
      assert.ok(validReports.has(pair.source_report_ref));
      assert.ok([r1, r2].includes(pair.recipient_id));
      assert.ok(ACCOUNTS.includes(pair.account_id));
      keys.add(`${pair.source_report_ref}|${pair.recipient_id}|${pair.account_id}`);
    }
    assert.equal(keys.size, step.allowed_pairs.length);
    state.guard = keys;
  } else if (step.kind === 'verify_guard') {
    const targets = targetPairs(observation);
    state.guardVerified = Boolean(
      state.guard &&
        [...targets].every((key) => state.guard.has(key)) &&
        [...state.guard].every((key) => targets.has(key)),
    );
  } else if (step.kind === 'cutover_workers') {
    assert.ok(Array.isArray(step.worker_ids));
    assert.equal(step.model_id, m2.model_id);
    assert.equal(step.query, m2.query);
    for (const id of step.worker_ids) {
      assert.ok(['w1', 'w2'].includes(id));
      workers[id] = { model_id: m2.model_id, query: m2.query };
    }
  } else if (step.kind === 'verify_matrix') {
    state.matrixVerified = true;
  } else {
    throw new Error(`unsupported rollout step ${step.kind}`);
  }
  trace.push({
    operation: 'rollout-step',
    phase,
    step: structuredClone(step),
    guard_verified: state.guardVerified,
  });
}

function targetPairs(observation) {
  const s1 = observation.signed_business_amendment;
  const s2 = observation.signed_s2_assignment;
  const pairs = new Set();
  for (const [recipient, accounts] of Object.entries(s1.permitted_recipient_accounts)) {
    for (const account of accounts) {
      pairs.add(`${s1.source_report_ref}|${recipient}|${account}`);
    }
  }
  for (const account of s2.assigned_account_ids) {
    pairs.add(`${s2.source_report_ref}|${s2.recipient_id}|${account}`);
  }
  return pairs;
}

function recipientReceipt(initial, chunk, at) {
  const source = initial.sources.get(chunk.source_report_ref);
  assert.ok(source && source.entry.stage.stage_ref === chunk.source_stage_ref);
  const cells = chunk.cells.map((cell) => source.byRow.get(cell.row));
  assert.ok(cells.every((cell) => cell?.column === 'ssn'));
  return {
    receipt_id: `migrcpt-${hash(`f10-v32|${initial.seed}|${chunk.delivery_id}`).slice(0, 18)}`,
    origin: 'authored-shared-report-recipient-publisher',
    status: 'delivered',
    delivery_id: chunk.delivery_id,
    delivered_at: at,
    recipient_id: chunk.recipient_id,
    source_stage_ref: chunk.source_stage_ref,
    source_report_ref: chunk.source_report_ref,
    cells: chunk.cells.map((cell) => ({ ...cell })),
    lineage: cells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      source_stage_ref: chunk.source_stage_ref,
      source_report_ref: chunk.source_report_ref,
      source_value_sha256: hash(String(cell.value)),
    })),
  };
}

function dispatch(at, context) {
  const { initial, observation, tuples, workers, pending, receipts, trace, state } = context;
  for (const chunk of pending) {
    if (chunk.state === 'acknowledged') {
      continue;
    }
    const checked = modelCheck(workers[chunk.worker_id], chunk, tuples, observation.policy_models);
    const guardKey = `${chunk.source_report_ref}|${chunk.recipient_id}|${chunk.account_id}`;
    const guarded = state.guard === null || state.guard.has(guardKey);
    const result = state.publisherPaused
      ? 'publisher-paused'
      : state.heldReports.has(chunk.source_report_ref)
        ? 'scoped-ssn-hold'
        : checked.allowed && guarded
          ? 'permitted-by-model-and-guard'
          : 'denied-by-model-or-guard';
    const event = {
      operation: 'authored-recipient-dispatch',
      at,
      delivery_id: chunk.delivery_id,
      worker_id: chunk.worker_id,
      recipient_id: chunk.recipient_id,
      source_report_ref: chunk.source_report_ref,
      account_id: chunk.account_id,
      model_check: checked,
      report_guard_allowed: guarded,
      result,
    };
    if (result === 'permitted-by-model-and-guard') {
      const receipt = recipientReceipt(initial, chunk, at);
      receipts.push(receipt);
      chunk.state = 'acknowledged';
      event.receipt = structuredClone(receipt);
    }
    trace.push(event);
  }
}

function futureNativeEtl(initial, pause, trace) {
  const transcript =
    initial.base.proof.native_v30_proof.native_v28_proof.native_v25_proof.transcript;
  const etlGrant = transcript
    .find((entry) => entry.command.tool === 'grants')
    .response.grants.find((entry) => entry.identity === initial.etlJob.actor_binding[0]);
  assert.ok(etlGrant);
  assert.equal(
    stepOffense(initial.s1Session, { tool: 'assume', args: { grant_id: etlGrant.grant_id } }).ok,
    true,
  );
  const query = stepOffense(initial.s1Session, {
    tool: 'query',
    args: { row_ids: [0, 1, 2], columns: ['dob'] },
  });
  assert.equal(query.ok, true);
  const stage = stepOffense(initial.s1Session, {
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
    const published = stepOffense(initial.s1Session, {
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
  return initial.s1Session.sink
    .filter((entry) => entry.receipt.stage_ref === stage.stage.stage_ref)
    .map((entry) => ({
      receipt: structuredClone(entry.receipt),
      cells: structuredClone(entry.cells),
    }));
}

function outcome(initial, observation, context, nativeEtlSink, s1Retry, s2Retry) {
  const { receipts, trace, workers, tuples, state } = context;
  const targets = targetPairs(observation);
  const newReceipts = receipts.slice(1);
  const unauthorizedReceipts = newReceipts.filter((receipt) =>
    receipt.cells.some(
      (cell) =>
        !targets.has(
          `${receipt.source_report_ref}|${receipt.recipient_id}|${initial.accountByRow.get(cell.row)}`,
        ),
    ),
  );
  const unauthorizedCells = unauthorizedReceipts.flatMap((receipt) =>
    receipt.cells.filter(
      (cell) =>
        !targets.has(
          `${receipt.source_report_ref}|${receipt.recipient_id}|${initial.accountByRow.get(cell.row)}`,
        ),
    ),
  ).length;
  const missingByReport = Object.fromEntries(
    [...initial.sources.keys()].map((reportRef) => {
      const source = initial.sources.get(reportRef);
      const perRecipient = Object.fromEntries(
        Object.values(observation.recipients).map((recipient) => {
          const delivered = new Set(
            receipts
              .filter(
                (receipt) =>
                  receipt.source_report_ref === reportRef && receipt.recipient_id === recipient,
              )
              .flatMap((receipt) => receipt.cells.map(cellKey)),
          );
          const required = [...source.byRow]
            .filter(([row]) =>
              targets.has(`${reportRef}|${recipient}|${initial.accountByRow.get(row)}`),
            )
            .map(([row]) => `${row}|ssn`);
          return [recipient, required.filter((key) => !delivered.has(key))];
        }),
      );
      return [reportRef, perRecipient];
    }),
  );
  const allKeys = receipts.flatMap((receipt) =>
    receipt.cells.map(
      (cell) => `${receipt.source_report_ref}|${receipt.recipient_id}|${cellKey(cell)}`,
    ),
  );
  const lineageValid = receipts.every((receipt) => {
    const source = initial.sources.get(receipt.source_report_ref);
    return Boolean(
      source &&
        receipt.source_stage_ref === source.entry.stage.stage_ref &&
        receipt.lineage.length === receipt.cells.length &&
        receipt.lineage.every((item, index) => {
          const cell = receipt.cells[index];
          const nativeCell = source.byRow.get(cell.row);
          return (
            nativeCell &&
            item.row === cell.row &&
            item.column === cell.column &&
            item.source_stage_ref === source.entry.stage.stage_ref &&
            item.source_report_ref === source.entry.stage.report_ref &&
            item.source_value_sha256 === hash(String(nativeCell.value))
          );
        }),
    );
  });
  const historical = observation.historical_assignment_ledger
    .filter(
      (record) =>
        record.recipient_id === initial.priorReceipt.recipient_id && record.effective_at <= 130,
    )
    .sort((a, b) => b.effective_at - a.effective_at)[0];
  return {
    trace,
    r1: observation.recipients.r1,
    r2: observation.recipients.r2,
    s1_report_ref: initial.s1Source.stage.report_ref,
    s2_report_ref: initial.s2Source.stage.report_ref,
    worker_pins_terminal: workers,
    tuple_ledger_terminal: tuples,
    guard_entries_terminal: state.guard ? [...state.guard] : null,
    guard_verified: state.guardVerified,
    recipient_receipts: receipts,
    unauthorized_receipts: unauthorizedReceipts,
    unauthorized_recipient_cells: unauthorizedCells,
    unauthorized_s1_cells: unauthorizedReceipts
      .filter((receipt) => receipt.source_report_ref === initial.s1Source.stage.report_ref)
      .flatMap((receipt) => receipt.cells).length,
    missing_by_report: missingByReport,
    missing_required_cells: Object.values(missingByReport).flatMap((byRecipient) =>
      Object.values(byRecipient).flat(),
    ).length,
    duplicate_recipient_cell_delivery: new Set(allKeys).size !== allKeys.length,
    lineage_valid: lineageValid,
    prior_s1_ack_authorized: Boolean(
      historical &&
        initial.priorReceipt.cells.every((cell) =>
          historical.assigned_account_ids.includes(initial.accountByRow.get(cell.row)),
        ),
    ),
    s1_source_retry_denied: !s1Retry.ok && s1Retry.reason === 'stage-not-publishable',
    s2_source_retry_denied: !s2Retry.ok && s2Retry.reason === 'stage-not-publishable',
    native_future_etl_sink: nativeEtlSink,
  };
}

export function replayPlan(seed, arm, plan = {}) {
  assert.ok(['a', 'b'].includes(arm));
  const initial = initialState(seed);
  const observation = initial.observation;
  observation.signed_s2_assignment.assigned_account_ids = arm === 'a' ? ['acct-C'] : [];
  const tuples = structuredClone(observation.relationship_tuples);
  const workers = structuredClone(observation.worker_pins);
  const pending = [
    ...structuredClone(observation.pending_recipient_chunks),
    structuredClone(initial.s2Chunk),
  ];
  const receipts = [structuredClone(initial.priorReceipt)];
  const trace = [
    { operation: 'authored-s1-prior-ack', receipt_id: initial.priorReceipt.receipt_id },
    { operation: 'native-s2-stage', stage: observation.s2_stage, job_id: initial.s2Job.job_id },
    { operation: 'authored-s2-queue-handoff', receipt: structuredClone(initial.s2Handoff) },
  ];
  const state = {
    heldReports: new Set(),
    publisherPaused: false,
    guard: null,
    guardVerified: false,
    matrixVerified: false,
  };
  const context = { initial, observation, tuples, workers, pending, receipts, trace, state };
  const before = plan.before_dispatch ?? [];
  const after = plan.after_first_dispatch ?? [];
  assert.ok(Array.isArray(before) && Array.isArray(after));
  for (const step of before) {
    applyStep(step, 'before_dispatch', context);
  }
  dispatch(160, context);
  for (const step of after) {
    applyStep(step, 'after_first_dispatch', context);
  }
  const nativeEtlSink = futureNativeEtl(initial, state.publisherPaused, trace);
  dispatch(180, context);
  const s1Retry = stepOffense(initial.s1Session, {
    tool: 'publish',
    args: {
      profile_id: initial.sourceJob.publisher_bindings[0].profile_id,
      destination: initial.sourceJob.destination,
      staged_refs: [initial.s1Source.stage.stage_ref],
    },
  });
  const s2Retry = stepOffense(initial.s2Session, {
    tool: 'publish',
    args: {
      profile_id: initial.s2Job.publisher_bindings[0].profile_id,
      destination: initial.s2Job.destination,
      staged_refs: [initial.s2Source.stage.stage_ref],
    },
  });
  return outcome(initial, observation, context, nativeEtlSink, s1Retry, s2Retry);
}

export function verifyNativeProof(proof) {
  verifyV31(proof.native_v31_proof);
  assert.deepEqual(produceCase(proof.seed, 'a').proof, proof);
  return true;
}
