import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { catalogObservation, createOffenseSession, stepOffense } from '../v13/chain.mjs';
import {
  instanceWorld,
  publisherProfileId,
  runExportPlane,
  scheduledPublisherPrincipal,
  visiblePolicy,
} from '../v13/estate.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const key = (cell) => `${cell.row}|${cell.column}`;
const ACCOUNT_ROWS = Object.freeze([
  { row: 0, account_id: 'acct-A' },
  { row: 1, account_id: 'acct-A' },
  { row: 2, account_id: 'acct-B' },
  { row: 3, account_id: 'acct-B' },
  { row: 4, account_id: 'acct-C' },
  { row: 5, account_id: 'acct-C' },
]);
const ASSIGNMENTS = Object.freeze({
  'assigned-first': ['acct-A', 'acct-B'],
  'assigned-last': ['acct-B', 'acct-C'],
  'assigned-all': ['acct-A', 'acct-B', 'acct-C'],
});
const assignedRows = (kind) =>
  ACCOUNT_ROWS.filter((entry) => ASSIGNMENTS[kind].includes(entry.account_id)).map(
    (entry) => entry.row,
  );

function accepted(session, transcript, tool, args = {}) {
  const command = { tool, args };
  const response = stepOffense(session, command);
  assert.equal(response.ok, true, `${tool}: ${response.reason}`);
  transcript.push({ command, response: structuredClone(response) });
  return response;
}

function stageExport(session, transcript, grant, rows, column, destination, jobRef) {
  accepted(session, transcript, 'assume', { grant_id: grant.grant_id });
  const query = accepted(session, transcript, 'query', { row_ids: rows, columns: [column] });
  return accepted(session, transcript, 'export', {
    report_ref: query.report_ref,
    destination,
    event_time: 110,
    job_ref: jobRef,
  }).stage.stage_ref;
}

function createCase(seed, kind) {
  assert.ok(Object.hasOwn(ASSIGNMENTS, kind));
  const base = instanceWorld(seed, 'row-batch');
  const etlJob = base.job_registry[0];
  assert.ok(etlJob);
  const actorIndex = base.identities.findIndex(
    (identity) =>
      identity.identity !== etlJob.actor_binding[0] &&
      identity.access_scope.columns.includes('ssn'),
  );
  assert.ok(actorIndex >= 0);
  const actor = base.identities[actorIndex].identity;
  const destination = etlJob.destination;
  const actualProfileId = publisherProfileId(
    seed,
    destination,
    actor,
    scheduledPublisherPrincipal(seed, actorIndex),
  );
  const sourceJob = {
    job_id: `job-${hash(`f10-v25|source-job|${seed}`).slice(0, 12)}`,
    approval_ref: `apr-${hash(`f10-v25|source-approval|${seed}`).slice(0, 10)}`,
    dataset: base.policy.dataset,
    destination,
    window: 0,
    approved_cell_volume: 6,
    actor_binding: [actor],
    publisher_bindings: [{ actor, profile_id: actualProfileId }],
    purpose: 'customer-report-staging',
  };
  const nonce = hash(`f10-v25|source|${seed}`);
  const session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce,
    extraJobs: [sourceJob],
  });
  const transcript = [];
  const jobs = accepted(session, transcript, 'jobs').jobs;
  const grants = accepted(session, transcript, 'grants').grants;
  const profiles = accepted(session, transcript, 'profiles').profiles;
  const etlGrant = grants.find((grant) => grant.identity === etlJob.actor_binding[0]);
  const sourceGrant = grants.find((grant) => grant.identity === actor);
  const etlProfile = profiles.find(
    (profile) => profile.profile_id === etlJob.publisher_bindings[0].profile_id,
  );
  const sourceProfile = profiles.find((profile) => profile.profile_id === actualProfileId);
  assert.ok(etlGrant && sourceGrant && etlProfile && sourceProfile);
  const targetStageRef = stageExport(
    session,
    transcript,
    sourceGrant,
    [0, 1, 2, 3, 4, 5],
    'ssn',
    destination,
    sourceJob.job_id,
  );
  const etlStageRef = stageExport(
    session,
    transcript,
    etlGrant,
    [0, 1, 2],
    'dob',
    destination,
    etlJob.job_id,
  );
  const sourceEntry = session.staged.get(targetStageRef);
  const etlEntry = session.staged.get(etlStageRef);
  assert.ok(sourceEntry && etlEntry);
  const recipientId = `recipient-${hash(`f10-v25|recipient|${seed}`).slice(0, 12)}`;
  const observation = {
    case_id: `case-${hash(`f10-v25|${seed}`).slice(0, 18)}`,
    policy: visiblePolicy(session.world),
    catalog: catalogObservation(session.world),
    job_registry: jobs,
    stage_manifests: [sourceEntry, etlEntry].map(({ stage, action, cells }) => ({
      stage_ref: stage.stage_ref,
      report_ref: stage.report_ref,
      actor: stage.report_owner,
      destination: stage.destination,
      event_time: stage.event_time,
      job_ref: action.job_ref,
      state: 'staged',
      source_cells: cells.map((cell) => ({
        row: cell.row,
        column: cell.column,
        value_sha256: hash(String(cell.value)),
      })),
    })),
    account_membership_ledger: {
      authority: 'authenticated-customer-account-ledger',
      owner_rows: ACCOUNT_ROWS.map((entry) => ({ ...entry })),
    },
    recipient_entitlement: {
      authority: 'authenticated-account-assignment',
      recipient_id: recipientId,
      assigned_account_ids: [...ASSIGNMENTS[kind]],
      permitted_columns: ['ssn'],
    },
    approved_delivery_request: {
      source_stage_ref: targetStageRef,
      recipient_id: recipientId,
      required_rows: 'all-owner-rows-of-currently-assigned-accounts',
      required_columns: ['ssn'],
    },
    publisher_checkpoint: {
      no_action: 'publish each unhandled native stage in full',
      projection_service:
        'A valid scoped delivery atomically substitutes a projection for full native publication of its source stage. A hold without a scoped delivery prevents that stage but does not complete the report.',
      etl_stage_ref: etlStageRef,
    },
  };
  const proof = {
    seed,
    nonce,
    transcript,
    initial_sink: structuredClone(session.sink),
    initial_ledger: structuredClone(session.ledger),
    source_stage_cells: structuredClone(sourceEntry.cells),
    etl_stage_cells: structuredClone(etlEntry.cells),
  };
  return {
    session,
    observation,
    proof,
    targetStageRef,
    etlStageRef,
    sourceEntry,
    etlEntry,
    sourceProfile,
    etlProfile,
    destination,
    recipientId,
  };
}

export function produceCase(seed = 64007, kind = 'assigned-first') {
  const item = createCase(seed, kind);
  return {
    observation: item.observation,
    proof: item.proof,
    answer: {
      target_stage_ref: item.targetStageRef,
      etl_stage_ref: item.etlStageRef,
      required_row_ids: assignedRows(kind),
    },
  };
}

export function applyDecision(seed, kind, action) {
  const item = createCase(seed, kind);
  const {
    session,
    targetStageRef,
    etlStageRef,
    sourceEntry,
    sourceProfile,
    etlProfile,
    destination,
    recipientId,
  } = item;
  const holds = new Set(action?.hold_stage_refs ?? []);
  const submissions = Array.isArray(action?.deliveries) ? action.deliveries : [];
  const recipientReceipts = [];
  const rejectedActions = [];
  const sourceByKey = new Map(sourceEntry.cells.map((cell) => [key(cell), cell]));
  for (const [index, submission] of submissions.entries()) {
    const cells = submission?.cells;
    if (
      submission?.stage_ref !== targetStageRef ||
      typeof submission?.recipient_id !== 'string' ||
      !Array.isArray(cells) ||
      cells.length === 0 ||
      cells.some((cell) => !sourceByKey.has(key(cell)))
    ) {
      rejectedActions.push(index);
      continue;
    }
    const delivered = cells.map((cell) => sourceByKey.get(key(cell)));
    recipientReceipts.push({
      receipt_id: `prcpt-${hash(`f10-v25|${seed}|${index}|${JSON.stringify(cells)}`).slice(0, 18)}`,
      origin: 'authored-projection-service',
      status: 'delivered',
      recipient_id: submission.recipient_id,
      source_stage_ref: targetStageRef,
      source_report_ref: sourceEntry.stage.report_ref,
      cells: delivered.map((cell) => ({ row: cell.row, column: cell.column })),
      lineage: delivered.map((cell) => ({
        row: cell.row,
        column: cell.column,
        source_stage_ref: targetStageRef,
        source_report_ref: sourceEntry.stage.report_ref,
        source_value_sha256: hash(String(cell.value)),
      })),
    });
  }
  let originalStageDisposition = 'held';
  if (recipientReceipts.length > 0) {
    // Authored projection consumes the immutable source stage's publication right.
    // v13 publish checks `published`, so a later full-stage retry is denied.
    sourceEntry.published = true;
    sourceEntry.projection_consumed = true;
    originalStageDisposition = 'authored-projection-consumed';
  }
  if (recipientReceipts.length === 0 && !holds.has(targetStageRef)) {
    const published = stepOffense(session, {
      tool: 'publish',
      args: { profile_id: sourceProfile.profile_id, destination, staged_refs: [targetStageRef] },
    });
    assert.equal(published.ok, true, published.reason);
    const sink = session.sink.find((entry) => entry.receipt.stage_ref === targetStageRef);
    assert.ok(sink);
    recipientReceipts.push({
      receipt_id: sink.receipt.receipt_id,
      origin: 'v13-native-full-publish',
      status: sink.receipt.status,
      recipient_id: recipientId,
      source_stage_ref: targetStageRef,
      source_report_ref: sourceEntry.stage.report_ref,
      cells: sink.cells.map((cell) => ({ row: cell.row, column: cell.column })),
      lineage: sink.cells.map((cell) => ({
        row: cell.row,
        column: cell.column,
        source_stage_ref: targetStageRef,
        source_report_ref: sourceEntry.stage.report_ref,
        source_value_sha256: hash(String(cell.value)),
      })),
    });
    originalStageDisposition = 'v13-native-full-published';
  }
  if (!holds.has(etlStageRef)) {
    const published = stepOffense(session, {
      tool: 'publish',
      args: { profile_id: etlProfile.profile_id, destination, staged_refs: [etlStageRef] },
    });
    assert.equal(published.ok, true, published.reason);
  }
  const etlReceipts = session.sink.filter((entry) => entry.receipt.stage_ref === etlStageRef);
  let postProjectionNativeRetryDenied = null;
  if (originalStageDisposition === 'authored-projection-consumed') {
    const retry = stepOffense(session, {
      tool: 'publish',
      args: { profile_id: sourceProfile.profile_id, destination, staged_refs: [targetStageRef] },
    });
    postProjectionNativeRetryDenied = !retry.ok && retry.reason === 'stage-not-publishable';
    assert.equal(postProjectionNativeRetryDenied, true);
    assert.equal(
      session.sink.some((entry) => entry.receipt.stage_ref === targetStageRef),
      false,
    );
  }
  const nativeUncoveredDeliveredCells = runExportPlane(
    session.actions,
    session.world,
  ).groups.reduce((count, group) => count + group.uncovered_cells, 0);
  const required = new Set(assignedRows(kind).map((row) => `${row}|ssn`));
  const deliveredKeys = recipientReceipts.flatMap((receipt) => receipt.cells.map(key));
  const deliveredSet = new Set(deliveredKeys);
  const unauthorizedRecipientCells = recipientReceipts.reduce(
    (count, receipt) =>
      count +
      receipt.cells.filter(
        (cell) => receipt.recipient_id !== recipientId || !required.has(key(cell)),
      ).length,
    0,
  );
  const lineageValid = recipientReceipts.every(
    (receipt) =>
      receipt.source_stage_ref === targetStageRef &&
      receipt.source_report_ref === sourceEntry.stage.report_ref &&
      receipt.lineage.length === receipt.cells.length &&
      receipt.lineage.every((lineage, index) => {
        const source = sourceByKey.get(key(receipt.cells[index]));
        return (
          source &&
          lineage.row === source.row &&
          lineage.column === source.column &&
          lineage.source_stage_ref === targetStageRef &&
          lineage.source_report_ref === sourceEntry.stage.report_ref &&
          lineage.source_value_sha256 === hash(String(source.value))
        );
      }),
  );
  return {
    recipient_receipts: recipientReceipts,
    etl_native_receipts: etlReceipts.length,
    etl_native_sink_receipts: etlReceipts.map((entry) => structuredClone(entry.receipt)),
    native_uncovered_delivered_cells: nativeUncoveredDeliveredCells,
    original_stage_disposition: originalStageDisposition,
    original_stage_terminally_consumed: sourceEntry.published,
    post_projection_native_retry_denied: postProjectionNativeRetryDenied,
    delivered_row_ids: [
      ...new Set(recipientReceipts.flatMap((receipt) => receipt.cells.map((cell) => cell.row))),
    ].sort((a, b) => a - b),
    unauthorized_recipient_cells: unauthorizedRecipientCells,
    missing_required_cells: [...required].filter((cell) => !deliveredSet.has(cell)).length,
    duplicate_delivery: deliveredKeys.length !== deliveredSet.size || recipientReceipts.length > 1,
    lineage_valid: lineageValid,
    rejected_actions: rejectedActions,
  };
}

export function verifyNativeProof(proof) {
  const item = createCase(proof.seed, 'assigned-first');
  assert.deepEqual(item.proof, proof);
  return true;
}
