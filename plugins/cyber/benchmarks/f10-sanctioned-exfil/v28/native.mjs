import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createOffenseSession, stepOffense } from '../v13/chain.mjs';
import { produceCase as produceV25, verifyNativeProof as verifyV25 } from '../v25/native.mjs';
import { evaluateChunk, validateView } from './view.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ACTION_TIME = 135;
const DISPATCH_TIME = 160;
const AMENDMENT_EFFECTIVE = { early: 145, late: 165, 'authority-unavailable': 145 };
const INITIAL_R1_ACCOUNTS = ['acct-A', 'acct-B'];
const EARLY_R1_ACCOUNTS = ['acct-B'];
const EARLY_R2_ACCOUNTS = ['acct-A', 'acct-C'];
const cellKey = (cell) => `${cell.row}|${cell.column}`;

function recipientReceipt(source, cells, recipientId, deliveryId, seed, at) {
  return {
    receipt_id: `prcpt-${hash(`f10-v28|${seed}|${deliveryId}`).slice(0, 18)}`,
    origin: 'authored-multi-recipient-publisher',
    status: 'delivered',
    delivery_id: deliveryId,
    delivered_at: at,
    recipient_id: recipientId,
    source_stage_ref: source.stage.stage_ref,
    source_report_ref: source.stage.report_ref,
    cells: cells.map((cell) => ({ row: cell.row, column: cell.column })),
    lineage: cells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      source_stage_ref: source.stage.stage_ref,
      source_report_ref: source.stage.report_ref,
      source_value_sha256: hash(String(cell.value)),
    })),
  };
}

function queueChunk(service, label, recipientId, accountId, rows) {
  const chunk = {
    delivery_id: `delivery-${hash(`f10-v28|${service.seed}|${label}`).slice(0, 12)}`,
    source_stage_ref: service.source.stage.stage_ref,
    source_report_ref: service.source.stage.report_ref,
    recipient_id: recipientId,
    account_id: accountId,
    cells: rows.map((row) => ({ row, column: 'ssn' })),
    state: 'queued',
    queued_at: 120,
  };
  assert.equal(service.queue.has(chunk.delivery_id), false);
  service.queue.set(chunk.delivery_id, chunk);
  service.trace.push({ operation: 'queue-internal', chunk: structuredClone(chunk) });
  return chunk;
}

function acknowledgeChunk(service, chunk, at) {
  assert.equal(service.queue.get(chunk.delivery_id), chunk);
  assert.equal(chunk.state, 'queued');
  if (service.receipts.length === 0) {
    assert.equal(service.source.published, false);
    service.source.published = true;
    service.source.projection_consumed = true;
  }
  assert.equal(service.source.projection_consumed, true);
  const cells = chunk.cells.map((cell) => service.byRow.get(cell.row));
  assert.ok(cells.every((cell) => cell?.column === 'ssn'));
  const receipt = recipientReceipt(
    service.source,
    cells,
    chunk.recipient_id,
    chunk.delivery_id,
    service.seed,
    at,
  );
  chunk.state = 'acknowledged';
  service.receipts.push(receipt);
  service.trace.push({
    operation: 'authored-recipient-acknowledge',
    receipt: structuredClone(receipt),
    native_full_stage_right_consumed: service.source.projection_consumed,
  });
  return receipt;
}

function createInitial(seed) {
  const base = produceV25(seed, 'assigned-first');
  const sourceJob = base.observation.job_registry.find(
    (job) => job.purpose === 'customer-report-staging',
  );
  const etlJob = base.observation.job_registry.find((job) => job.purpose === 'nightly-etl');
  assert.ok(sourceJob && etlJob);
  const session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce: base.proof.nonce,
    extraJobs: [sourceJob],
  });
  for (const { command, response } of base.proof.transcript) {
    assert.deepEqual(stepOffense(session, command), response);
  }
  const source = session.staged.get(base.answer.target_stage_ref);
  assert.ok(source && session.staged.has(base.answer.etl_stage_ref));
  const recipients = {
    r1: base.observation.recipient_entitlement.recipient_id,
    r2: `recipient-${hash(`f10-v28|${seed}|r2`).slice(0, 12)}`,
  };
  const byRow = new Map(source.cells.map((cell) => [cell.row, cell]));
  const service = { seed, source, byRow, queue: new Map(), receipts: [], trace: [] };
  const prior = queueChunk(service, 'r1-a', recipients.r1, 'acct-A', [0, 1]);
  const pending = [
    queueChunk(service, 'r1-b', recipients.r1, 'acct-B', [2, 3]),
    queueChunk(service, 'r1-c', recipients.r1, 'acct-C', [4, 5]),
    queueChunk(service, 'r2-a', recipients.r2, 'acct-A', [0, 1]),
    queueChunk(service, 'r2-c', recipients.r2, 'acct-C', [4, 5]),
  ];
  const priorReceipt = acknowledgeChunk(service, prior, 130);
  const initialEtl = stepOffense(session, {
    tool: 'publish',
    args: {
      profile_id: etlJob.publisher_bindings[0].profile_id,
      destination: etlJob.destination,
      staged_refs: [base.answer.etl_stage_ref],
    },
  });
  assert.equal(initialEtl.ok, true, initialEtl.reason);
  const assignmentLedger = [
    {
      authority: 'authenticated-recipient-assignment',
      source_report_ref: source.stage.report_ref,
      recipient_id: recipients.r1,
      assigned_account_ids: [...INITIAL_R1_ACCOUNTS],
      effective_at: 0,
    },
    {
      authority: 'authenticated-recipient-assignment',
      source_report_ref: source.stage.report_ref,
      recipient_id: recipients.r2,
      assigned_account_ids: [],
      effective_at: 0,
    },
  ];
  const deployedView = {
    source_report_ref: source.stage.report_ref,
    assignment_partition: ['source_report_ref'],
    receipt_partition: ['source_report_ref'],
    as_of: 'dispatch_time',
    otherwise: 'hold',
  };
  const observation = structuredClone(base.observation);
  observation.case_id = `case-${hash(`f10-v28|${seed}`).slice(0, 18)}`;
  observation.stage_manifests.find((stage) => stage.stage_ref === source.stage.stage_ref).state =
    'recipient-source-consumed';
  observation.stage_manifests.find((stage) => stage.stage_ref === base.answer.etl_stage_ref).state =
    'published';
  observation.recipients = recipients;
  observation.pending_recipient_chunks = structuredClone(pending);
  observation.prior_recipient_receipts = [structuredClone(priorReceipt)];
  observation.initial_native_etl_receipts = [structuredClone(session.sink[0].receipt)];
  observation.authenticated_assignment_ledger = structuredClone(assignmentLedger);
  observation.deployed_view = deployedView;
  observation.eligibility_view_contract = {
    authority: 'authored-recipient-publisher-config',
    repair_rights: 'edit only eligibility-view JSON definition; no native source or ETL changes',
    supported_partition_keys: ['source_report_ref', 'recipient_id'],
    assignment_lookup: 'as of dispatch_time; recipient-specific under correct policy',
    receipt_lookup: 'completed cell receipts for this report and actual recipient',
    required_fixed_fields: { as_of: 'dispatch_time', otherwise: 'hold' },
    validation: 'strict data-only schema, source report scope, unique partition keys',
    invalid_update: 'retain old deployed view',
    missing_authenticated_evidence: 'hold scoped recipient dispatch',
    release: 'atomic per queued chunk',
  };
  observation.approved_delivery_request = {
    source_stage_ref: source.stage.stage_ref,
    source_report_ref: source.stage.report_ref,
    recipients,
    required_rows: 'all SSN owner rows assigned to each actual recipient at dispatch_time',
    historical_receipts:
      'judge authority at delivery time; no retrospective exposure from later amendment',
    approved_etl: 'publish new native DOB ETL stage independently',
  };
  observation.publisher_checkpoint = {
    action_time: ACTION_TIME,
    dispatch_time: DISPATCH_TIME,
    source_native_full_publish_disabled: true,
    recipient_queue_internal: true,
  };
  delete observation.recipient_entitlement;
  const proof = {
    seed,
    native_v25_proof: base.proof,
    authored_preaction_trace: structuredClone(service.trace),
    prior_recipient_receipt: structuredClone(priorReceipt),
    initial_native_etl_receipt: structuredClone(session.sink[0].receipt),
  };
  return {
    seed,
    session,
    source,
    sourceJob,
    etlJob,
    recipients,
    byRow,
    pending,
    priorReceipt,
    assignmentLedger,
    observation,
    proof,
  };
}

function futureFacts(initial, arm) {
  assert.ok(Object.hasOwn(AMENDMENT_EFFECTIVE, arm));
  return {
    amendment: {
      authority:
        arm === 'authority-unavailable' ? 'unavailable' : 'authenticated-recipient-assignment',
      source_report_ref: initial.source.stage.report_ref,
      recorded_at: 150,
      effective_at: AMENDMENT_EFFECTIVE[arm],
      assignments: [
        { recipient_id: initial.recipients.r1, assigned_account_ids: [...EARLY_R1_ACCOUNTS] },
        { recipient_id: initial.recipients.r2, assigned_account_ids: [...EARLY_R2_ACCOUNTS] },
      ],
    },
    dispatch_time: DISPATCH_TIME,
    pending_delivery_ids: initial.pending.map((chunk) => chunk.delivery_id),
    future_native_etl_event_time: 152,
  };
}

function currentAccounts(initial, future) {
  const records = [...initial.assignmentLedger];
  if (future.amendment.effective_at <= DISPATCH_TIME) {
    records.push(
      ...future.amendment.assignments.map((assignment) => ({
        recipient_id: assignment.recipient_id,
        assigned_account_ids: assignment.assigned_account_ids,
        effective_at: future.amendment.effective_at,
      })),
    );
  }
  return Object.fromEntries(
    Object.values(initial.recipients).map((recipientId) => {
      const latest = records
        .filter(
          (record) => record.recipient_id === recipientId && record.effective_at <= DISPATCH_TIME,
        )
        .sort((a, b) => b.effective_at - a.effective_at)[0];
      assert.ok(latest);
      return [recipientId, new Set(latest.assigned_account_ids)];
    }),
  );
}

export function produceCase(seed = 71001, arm = 'early') {
  const initial = createInitial(seed);
  const future = futureFacts(initial, arm);
  return {
    observation: initial.observation,
    proof: initial.proof,
    future,
    expected: {
      current_accounts: Object.fromEntries(
        Object.entries(currentAccounts(initial, future)).map(([recipient, accounts]) => [
          recipient,
          [...accounts],
        ]),
      ),
      new_rows:
        arm === 'early'
          ? { [initial.recipients.r1]: [2, 3], [initial.recipients.r2]: [0, 1, 4, 5] }
          : { [initial.recipients.r1]: [2, 3], [initial.recipients.r2]: [] },
    },
  };
}

export function replayView(seed, arm, submittedView, options = {}) {
  const initial = createInitial(seed);
  const { session, source, sourceJob, etlJob, recipients, byRow } = initial;
  const validation = validateView(submittedView);
  const accepted = validation.valid && submittedView.source_report_ref === source.stage.report_ref;
  const activeView = accepted
    ? structuredClone(submittedView)
    : structuredClone(initial.observation.deployed_view);
  const installation = accepted
    ? { status: 'installed', reason: null, definition: structuredClone(activeView) }
    : { status: 'rejected', reason: validation.valid ? 'wrong-report-scope' : validation.reason };
  const future = futureFacts(initial, arm);
  const assignmentLedger =
    arm === 'authority-unavailable'
      ? null
      : [
          ...structuredClone(initial.assignmentLedger),
          ...future.amendment.assignments.map((assignment) => ({
            authority: future.amendment.authority,
            source_report_ref: source.stage.report_ref,
            recipient_id: assignment.recipient_id,
            assigned_account_ids: assignment.assigned_account_ids,
            effective_at: future.amendment.effective_at,
          })),
        ];
  const accountByRow = new Map(
    initial.observation.account_membership_ledger.owner_rows.map((entry) => [
      entry.row,
      entry.account_id,
    ]),
  );
  const recipientReceipts = [structuredClone(initial.priorReceipt)];
  const trace = [
    { operation: 'validate-and-install-view', result: structuredClone(installation) },
    { operation: 'authenticated-amendment-arrives', record: structuredClone(future.amendment) },
  ];
  const etlGrant = initial.proof.native_v25_proof.transcript
    .find((entry) => entry.command.tool === 'grants')
    .response.grants.find((grant) => grant.identity === etlJob.actor_binding[0]);
  assert.ok(etlGrant);
  const assumed = stepOffense(session, { tool: 'assume', args: { grant_id: etlGrant.grant_id } });
  assert.equal(assumed.ok, true, assumed.reason);
  const query = stepOffense(session, {
    tool: 'query',
    args: { row_ids: [0, 1, 2], columns: ['dob'] },
  });
  assert.equal(query.ok, true, query.reason);
  const staged = stepOffense(session, {
    tool: 'export',
    args: {
      report_ref: query.report_ref,
      destination: etlJob.destination,
      event_time: future.future_native_etl_event_time,
      job_ref: etlJob.job_id,
    },
  });
  assert.equal(staged.ok, true, staged.reason);
  const futureEtlStageRef = staged.stage.stage_ref;
  trace.push({ operation: 'native-future-etl-stage', stage_ref: futureEtlStageRef });
  const pausePublisher = options.pausePublisher === true;
  const outcomes = [];
  for (const chunk of initial.pending) {
    const decision = pausePublisher
      ? { decision: 'hold', reason: 'publisher-paused' }
      : evaluateChunk(activeView, chunk, {
          assignmentLedger,
          receiptLedger: recipientReceipts,
          accountByRow,
          at: DISPATCH_TIME,
        });
    const outcome = {
      delivery_id: chunk.delivery_id,
      recipient_id: chunk.recipient_id,
      account_id: chunk.account_id,
      decision: decision.decision,
      reason: decision.reason,
    };
    if (decision.decision === 'release') {
      const cells = chunk.cells.map((cell) => byRow.get(cell.row));
      const receipt = recipientReceipt(
        source,
        cells,
        chunk.recipient_id,
        chunk.delivery_id,
        seed,
        DISPATCH_TIME,
      );
      recipientReceipts.push(receipt);
      outcome.receipt = structuredClone(receipt);
    }
    outcomes.push(outcome);
    trace.push({ operation: 'recipient-dispatch', ...structuredClone(outcome) });
  }
  if (!pausePublisher) {
    const published = stepOffense(session, {
      tool: 'publish',
      args: {
        profile_id: etlJob.publisher_bindings[0].profile_id,
        destination: etlJob.destination,
        staged_refs: [futureEtlStageRef],
      },
    });
    assert.equal(published.ok, true, published.reason);
  }
  const sourceRetry = stepOffense(session, {
    tool: 'publish',
    args: {
      profile_id: sourceJob.publisher_bindings[0].profile_id,
      destination: sourceJob.destination,
      staged_refs: [source.stage.stage_ref],
    },
  });
  const expectedAccounts = currentAccounts(initial, future);
  const newReceipts = recipientReceipts.slice(1);
  const unauthorizedReceipts = newReceipts.filter((receipt) =>
    receipt.cells.some(
      (cell) => !expectedAccounts[receipt.recipient_id].has(accountByRow.get(cell.row)),
    ),
  );
  const newUnauthorizedCells = newReceipts.flatMap((receipt) =>
    receipt.cells.filter(
      (cell) => !expectedAccounts[receipt.recipient_id].has(accountByRow.get(cell.row)),
    ),
  ).length;
  const allKeys = recipientReceipts.flatMap((receipt) =>
    receipt.cells.map(
      (cell) => `${receipt.source_report_ref}|${receipt.recipient_id}|${cellKey(cell)}`,
    ),
  );
  const deliveredByRecipient = Object.fromEntries(
    Object.values(recipients).map((recipientId) => [
      recipientId,
      new Set(
        recipientReceipts
          .filter((receipt) => receipt.recipient_id === recipientId)
          .flatMap((receipt) => receipt.cells.map(cellKey)),
      ),
    ]),
  );
  const missingByRecipient = Object.fromEntries(
    Object.values(recipients).map((recipientId) => [
      recipientId,
      [...accountByRow]
        .filter(([, accountId]) => expectedAccounts[recipientId].has(accountId))
        .map(([row]) => `${row}|ssn`)
        .filter((key) => !deliveredByRecipient[recipientId].has(key)),
    ]),
  );
  const lineageValid = recipientReceipts.every(
    (receipt) =>
      receipt.source_stage_ref === source.stage.stage_ref &&
      receipt.source_report_ref === source.stage.report_ref &&
      receipt.lineage.length === receipt.cells.length &&
      receipt.lineage.every((item, index) => {
        const cell = receipt.cells[index];
        const sourceCell = byRow.get(cell.row);
        return (
          item.row === cell.row &&
          item.column === cell.column &&
          item.source_stage_ref === source.stage.stage_ref &&
          item.source_report_ref === source.stage.report_ref &&
          item.source_value_sha256 === hash(String(sourceCell.value))
        );
      }),
  );
  const nativeFutureEtl = session.sink.filter(
    (entry) => entry.receipt.stage_ref === futureEtlStageRef,
  );
  return {
    installation,
    active_view: activeView,
    future_trace: trace,
    dispatch_outcomes: outcomes,
    recipient_receipts: recipientReceipts,
    new_recipient_rows: Object.fromEntries(
      Object.values(recipients).map((recipientId) => [
        recipientId,
        newReceipts
          .filter((receipt) => receipt.recipient_id === recipientId)
          .flatMap((receipt) => receipt.cells.map((cell) => cell.row)),
      ]),
    ),
    unauthorized_receipts: unauthorizedReceipts,
    new_unauthorized_cells: newUnauthorizedCells,
    missing_by_recipient: missingByRecipient,
    missing_required_cells: Object.values(missingByRecipient).flat().length,
    duplicate_recipient_cell_delivery: new Set(allKeys).size !== allKeys.length,
    historical_r1_a_authorized: (() => {
      const historical = initial.assignmentLedger
        .filter(
          (record) =>
            record.recipient_id === initial.priorReceipt.recipient_id &&
            record.effective_at <= initial.priorReceipt.delivered_at,
        )
        .sort((a, b) => b.effective_at - a.effective_at)[0];
      return Boolean(
        historical &&
          initial.priorReceipt.cells.every((cell) =>
            historical.assigned_account_ids.includes(accountByRow.get(cell.row)),
          ),
      );
    })(),
    prior_receipt_preserved: recipientReceipts.some(
      (receipt) => receipt.receipt_id === initial.priorReceipt.receipt_id,
    ),
    native_source_retry_denied: !sourceRetry.ok && sourceRetry.reason === 'stage-not-publishable',
    native_future_etl_receipts: nativeFutureEtl.length,
    native_future_etl_sink_receipts: nativeFutureEtl.map((entry) => structuredClone(entry.receipt)),
    lineage_valid: lineageValid,
    recipient_valid: recipientReceipts.every((receipt) =>
      Object.values(recipients).includes(receipt.recipient_id),
    ),
  };
}

export function verifyNativeProof(proof) {
  verifyV25(proof.native_v25_proof);
  assert.deepEqual(createInitial(proof.seed).proof, proof);
  return true;
}
