import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  produceCase as produceTransport,
  verifyNativeProof as verifyTransportProof,
} from '../v18/native.mjs';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const cellKey = (row, column) => JSON.stringify([row, column]);
const flowKey = (identity, destination, window) => JSON.stringify([identity, destination, window]);

function approvalPlane(seed, transport, delegatedAtIssue) {
  const jobRevisions = transport.visible.job_ledger.map((revision) => ({
    ...revision,
    approval_ref: `apr-${hash(`f10-v19|${seed}|${revision.job_id}`).slice(0, 16)}`,
  }));
  const tickets = jobRevisions.map((revision) => ({
    ticket_id: `ticket-${hash(`f10-v19|ticket|${revision.job_id}`).slice(0, 16)}`,
    approval_ref: revision.approval_ref,
    job_id: revision.job_id,
    decision: 'approved',
    issued_at: 9,
    signer: revision.cell_scope.columns.includes('ssn')
      ? 'data-owner-customers'
      : 'data-owner-operations',
    dataset: revision.dataset,
    destination: revision.destination,
    window: revision.window,
    actor_bindings: structuredClone(revision.actor_bindings),
    publisher_bindings: structuredClone(revision.publisher_bindings),
    cell_scope: structuredClone(revision.cell_scope),
    approved_cell_volume: revision.approved_cell_volume,
  }));
  const delegations = [
    {
      signer: 'data-owner-customers',
      dataset: transport.visible.policy.dataset,
      destination: jobRevisions[0].destination,
      valid_from: delegatedAtIssue ? 0 : 10,
      valid_until: 900,
      authority: 'approve-protected-export',
    },
    {
      signer: 'data-owner-operations',
      dataset: transport.visible.policy.dataset,
      destination: jobRevisions[0].destination,
      valid_from: 0,
      valid_until: 900,
      authority: 'approve-protected-export',
    },
  ];
  const auditTime =
    Math.max(...transport.visible.receipts.map((receipt) => receipt.completed_at)) + 20;
  const currentDelegations = delegations.map(({ valid_from, valid_until, ...entry }) => ({
    ...entry,
    active: valid_from <= auditTime && auditTime < valid_until,
  }));
  assert.ok(currentDelegations.every((entry) => entry.active));
  return {
    jobRevisions,
    tickets,
    delegations,
    currentDelegations,
    auditTime,
    registrationLog: jobRevisions.map((revision, index) => ({
      sequence: index + 1,
      action: 'register-job-revision',
      job_id: revision.job_id,
      approval_ref: revision.approval_ref,
      authenticated: true,
    })),
    ticketLog: tickets.map((ticket, index) => ({
      sequence: index + 1,
      action: 'record-change-approval',
      ticket_id: ticket.ticket_id,
      issued_at: ticket.issued_at,
      authenticated: true,
    })),
  };
}

function validTicket(revision, ticket, delegations) {
  if (
    !ticket ||
    ticket.decision !== 'approved' ||
    ticket.approval_ref !== revision.approval_ref ||
    ticket.job_id !== revision.job_id ||
    ticket.dataset !== revision.dataset ||
    ticket.destination !== revision.destination ||
    ticket.window !== revision.window ||
    ticket.approved_cell_volume !== revision.approved_cell_volume ||
    JSON.stringify(ticket.actor_bindings) !== JSON.stringify(revision.actor_bindings) ||
    JSON.stringify(ticket.publisher_bindings) !== JSON.stringify(revision.publisher_bindings) ||
    JSON.stringify(ticket.cell_scope) !== JSON.stringify(revision.cell_scope)
  ) {
    return false;
  }
  return delegations.some(
    (grant) =>
      grant.signer === ticket.signer &&
      grant.dataset === ticket.dataset &&
      grant.destination === ticket.destination &&
      grant.authority === 'approve-protected-export' &&
      grant.valid_from <= ticket.issued_at &&
      ticket.issued_at < grant.valid_until,
  );
}

function scoreNative(transport, plane) {
  const policy = transport.visible.policy;
  const events = new Map(
    transport.proof.native_ledger.map((entry) => [entry.receipt.receipt_id, entry.event]),
  );
  const receipts = new Map(
    transport.visible.receipts.map((receipt) => [receipt.receipt_id, receipt]),
  );
  const tickets = new Map(plane.tickets.map((ticket) => [ticket.approval_ref, ticket]));
  const states = new Map();
  const uncoveredByGroup = new Map();
  const jobVolumes = new Map();
  for (const sink of transport.proof.native_sink) {
    const receipt = receipts.get(sink.receipt.receipt_id);
    const event = events.get(sink.receipt.receipt_id);
    assert.ok(receipt && event && receipt.event_id === event.event_id);
    assert.equal(sink.event_time, receipt.completed_at);
    const window = Math.floor(receipt.completed_at / policy.window_size);
    const group = JSON.stringify([event.destination, window]);
    const flow = flowKey(event.actor.identity, event.destination, window);
    if (!states.has(flow)) {
      states.set(flow, { protected: new Set(), uncovered: new Set(), group });
    }
    if (!uncoveredByGroup.has(group)) {
      uncoveredByGroup.set(group, new Set());
    }
    const state = states.get(flow);
    const revision = plane.jobRevisions
      .filter((job) => job.job_id === event.job_ref && job.effective_at <= receipt.completed_at)
      .sort((a, b) => b.effective_at - a.effective_at || b.revision - a.revision)[0];
    const ticket = tickets.get(revision?.approval_ref);
    const matches =
      revision?.status === 'approved' &&
      validTicket(revision, ticket, plane.delegations) &&
      revision.dataset === event.resource.dataset &&
      revision.destination === event.destination &&
      revision.window === window &&
      revision.actor_bindings.includes(event.actor.identity) &&
      revision.publisher_bindings.some(
        (binding) =>
          binding.actor === event.actor.identity && binding.profile_id === receipt.profile_id,
      );
    const capacity = jobVolumes.get(event.job_ref) ?? new Set();
    for (const cell of sink.cells
      .filter((item) => item.classification === 'protected')
      .sort((a, b) => a.row - b.row || a.column.localeCompare(b.column))) {
      const id = cellKey(cell.row, cell.column);
      state.protected.add(id);
      const covered =
        matches &&
        cell.row >= revision.cell_scope.row_min &&
        cell.row <= revision.cell_scope.row_max &&
        revision.cell_scope.columns.includes(cell.column) &&
        (capacity.has(id) || capacity.size < revision.approved_cell_volume);
      if (covered) {
        capacity.add(id);
        jobVolumes.set(event.job_ref, capacity);
      } else {
        state.uncovered.add(id);
        uncoveredByGroup.get(group).add(id);
      }
    }
  }
  return Object.fromEntries(
    transport.visible.flows.map((flow) => {
      const state = states.get(flowKey(flow.identity, flow.destination, flow.window));
      assert.ok(state);
      const crossing = uncoveredByGroup.get(state.group).size > policy.cumulative_aggregate_limit;
      const label =
        state.protected.size === 0
          ? 'benign'
          : state.uncovered.size === 0
            ? 'sanctioned-bulk'
            : crossing
              ? 'cumulative-exfil'
              : 'benign';
      return [flow.flow_id, label];
    }),
  );
}

export function produceCase(seed = 61001, delegatedAtIssue = true) {
  const nonce = hash(`f10-v19|native|${seed}`);
  const captureNonce = hash(`f10-v19|capture|${seed}`);
  const transport = produceTransport(seed, 'profile-match', { nonce, captureNonce });
  assert.equal(verifyTransportProof(transport.proof), true);
  const plane = approvalPlane(seed, transport, delegatedAtIssue);
  const labels = scoreNative(transport, plane);
  const visible = {
    ...transport.visible,
    job_ledger: plane.jobRevisions,
    registry_snapshot: transport.visible.registry_snapshot.map((job) => ({
      ...job,
      approval_ref: plane.jobRevisions.find((revision) => revision.job_id === job.job_id)
        .approval_ref,
    })),
    change_tickets: plane.tickets,
    delegation_history: plane.delegations,
    current_delegations: plane.currentDelegations,
    approval_lookup: {
      status: 'complete',
      queried_at: plane.auditTime,
      ticket_count: plane.tickets.length,
      delegation_count: plane.delegations.length,
    },
  };
  const proof = {
    seed,
    delegatedAtIssue,
    transport: transport.proof,
    registrationLog: plane.registrationLog,
    ticketLog: plane.ticketLog,
    jobRevisions: plane.jobRevisions,
    tickets: plane.tickets,
    delegations: plane.delegations,
    labels,
  };
  return { visible, answer: { labels }, proof };
}

export function verifyNativeProof(proof) {
  assert.deepEqual(produceCase(proof.seed, proof.delegatedAtIssue).proof, proof);
  return true;
}
