import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  produceCase as produceSource,
  verifyNativeProof as verifySourceProof,
} from '../v18/native.mjs';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const cellKey = (row, column) => JSON.stringify([row, column]);
const flowKey = (actor, recipient, window) => JSON.stringify([actor, recipient, window]);

function sourceSession(seed) {
  const nonce = hash(`f10-v20|source|${seed}`);
  const captureNonce = hash(`f10-v20|capture|${seed}`);
  const source = produceSource(seed, 'profile-match', { nonce, captureNonce });
  assert.equal(verifySourceProof(source.proof), true);
  return source;
}

function grantFor(seed, revision, recipient, completedAt, target) {
  return {
    grant_id: `share-${hash(`f10-v20|grant|${seed}|${revision.job_id}`).slice(0, 16)}`,
    revision: 1,
    status: 'approved',
    dataset: revision.dataset,
    recipient,
    source_job_id: revision.job_id,
    publisher_actor: revision.actor_bindings[0],
    cell_scope: structuredClone(revision.cell_scope),
    approved_cell_volume: revision.approved_cell_volume,
    effective_at: target ? completedAt - 1 : 0,
    expires_at: 900,
  };
}

function createDownstreamService(source, seed, recipient) {
  const sourceSinks = new Map(
    source.proof.native_sink.map((sink) => [sink.receipt.receipt_id, sink]),
  );
  const sourceEvents = new Map(
    source.proof.native_ledger.map((item) => [item.receipt.receipt_id, item.event]),
  );
  const downstreamSinks = [];
  const commands = [];
  const responses = [];
  return {
    downstreamSinks,
    commands,
    responses,
    publish({ parentReceiptIds, shareJobRef, actor, completedAt }) {
      assert.ok(parentReceiptIds.length > 0);
      const parents = parentReceiptIds.map((id) => {
        const sink = sourceSinks.get(id);
        const event = sourceEvents.get(id);
        assert.ok(sink && event && sink.receipt.status === 'delivered');
        assert.equal(sink.receipt.publisher_actor, actor);
        return { sink, event };
      });
      const sourceJobIds = [...new Set(parents.map(({ event }) => event.job_ref))];
      assert.equal(sourceJobIds.length, 1);
      const dataset = parents[0].event.resource.dataset;
      assert.ok(parents.every(({ event }) => event.resource.dataset === dataset));
      const cells = parents.flatMap(({ sink }) => sink.cells.map((cell) => ({ ...cell })));
      const receipt = {
        receipt_id: `drcpt-${hash(`f10-v20|${seed}|${actor}|${completedAt}`).slice(0, 18)}`,
        status: 'delivered',
        parent_receipt_ids: [...parentReceiptIds],
        source_job_id: sourceJobIds[0],
        share_job_ref: shareJobRef,
        dataset,
        recipient,
        publisher_actor: actor,
        completed_at: completedAt,
        delivered_cells: cells.map(({ row, column }) => ({ row, column })),
        cell_count: cells.length,
      };
      const command = {
        op: 'publish-downstream',
        parent_receipt_ids: [...parentReceiptIds],
        share_job_ref: shareJobRef,
        actor,
        recipient,
        completed_at: completedAt,
      };
      commands.push(command);
      responses.push({ ok: true, receipt: structuredClone(receipt) });
      downstreamSinks.push({ receipt, cells });
      return receipt;
    },
  };
}

function nativeDownstreamLabels(source, service, grants) {
  const limit = source.visible.policy.cumulative_aggregate_limit;
  const windowSize = source.visible.policy.window_size;
  const byGroup = new Map();
  const byFlow = new Map();
  for (const sink of service.downstreamSinks) {
    const receipt = sink.receipt;
    const window = Math.floor(receipt.completed_at / windowSize);
    const group = JSON.stringify([receipt.recipient, window]);
    const flow = flowKey(receipt.publisher_actor, receipt.recipient, window);
    if (!byGroup.has(group)) {
      byGroup.set(group, new Set());
    }
    if (!byFlow.has(flow)) {
      byFlow.set(flow, { group, protected: new Set(), uncovered: new Set() });
    }
    const state = byFlow.get(flow);
    const grant = grants.find((item) => item.grant_id === receipt.share_job_ref);
    const matches =
      grant?.status === 'approved' &&
      grant.dataset === receipt.dataset &&
      grant.recipient === receipt.recipient &&
      grant.source_job_id === receipt.source_job_id &&
      grant.publisher_actor === receipt.publisher_actor &&
      grant.effective_at <= receipt.completed_at &&
      receipt.completed_at < grant.expires_at;
    const sorted = sink.cells
      .filter((cell) => cell.classification === 'protected')
      .sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));
    const eligible = new Set();
    for (const cell of sorted) {
      const id = cellKey(cell.row, cell.column);
      state.protected.add(id);
      const covered =
        matches &&
        grant.cell_scope.row_min <= cell.row &&
        cell.row <= grant.cell_scope.row_max &&
        grant.cell_scope.columns.includes(cell.column) &&
        (eligible.has(id) || eligible.size < grant.approved_cell_volume);
      if (covered) {
        eligible.add(id);
      } else {
        state.uncovered.add(id);
        byGroup.get(group).add(id);
      }
    }
  }
  return Object.fromEntries(
    [...byFlow].map(([flow, state]) => {
      const crossing = byGroup.get(state.group).size > limit;
      return [
        flow,
        state.protected.size === 0
          ? 'benign'
          : state.uncovered.size === 0
            ? 'sanctioned-bulk'
            : crossing
              ? 'cumulative-exfil'
              : 'benign',
      ];
    }),
  );
}

export function produceCase(seed = 61001, grantEffectiveAtDelivery = true) {
  const source = sourceSession(seed);
  const recipient = `approved://partner-share-${hash(`f10-v20|recipient|${seed}`).slice(0, 12)}`;
  const completedAt =
    Math.max(...source.visible.receipts.map((receipt) => receipt.completed_at)) + 10;
  const targetJob = source.visible.job_ledger.find((job) => job.cell_scope.columns.includes('ssn'));
  const etlJob = source.visible.job_ledger.find((job) => job.cell_scope.columns.includes('dob'));
  assert.ok(targetJob && etlJob);
  const targetGrant = grantFor(seed, targetJob, recipient, completedAt, grantEffectiveAtDelivery);
  if (!grantEffectiveAtDelivery) {
    targetGrant.effective_at = completedAt + 1;
  }
  const etlGrant = grantFor(seed, etlJob, recipient, completedAt, false);
  const grants = [targetGrant, etlGrant];
  const service = createDownstreamService(source, seed, recipient);
  for (const [job, grant] of [
    [targetJob, targetGrant],
    [etlJob, etlGrant],
  ]) {
    const parentReceiptIds = source.visible.receipts
      .filter((receipt) => receipt.publisher_actor === job.actor_bindings[0])
      .map((receipt) => receipt.receipt_id);
    service.publish({
      parentReceiptIds,
      shareJobRef: grant.grant_id,
      actor: job.actor_bindings[0],
      completedAt,
    });
  }
  const downLabels = nativeDownstreamLabels(source, service, grants);
  const downstreamFlows = service.downstreamSinks.map((sink) => {
    const { receipt } = sink;
    const window = Math.floor(receipt.completed_at / source.visible.policy.window_size);
    return {
      flow_id: `dflow-${hash(`f10-v20|${seed}|${receipt.publisher_actor}|${recipient}|${window}`).slice(0, 18)}`,
      publisher_actor: receipt.publisher_actor,
      recipient,
      window,
    };
  });
  const downstreamLabels = Object.fromEntries(
    downstreamFlows.map((flow) => [
      flow.flow_id,
      downLabels[flowKey(flow.publisher_actor, flow.recipient, flow.window)],
    ]),
  );
  const visible = {
    case_id: `case-${hash(`f10-v20|case|${seed}`).slice(0, 18)}`,
    source: source.visible,
    downstream_grants: grants,
    downstream_current_grants: grants.map(({ effective_at, expires_at, ...grant }) => ({
      ...grant,
      active: effective_at <= completedAt + 20 && completedAt + 20 < expires_at,
    })),
    downstream_receipts: service.downstreamSinks.map(({ receipt }) => receipt),
    downstream_flows: downstreamFlows,
  };
  const proof = {
    seed,
    grantEffectiveAtDelivery,
    source: source.proof,
    downstream_commands: service.commands,
    downstream_responses: service.responses,
    downstream_sinks: service.downstreamSinks,
    grants,
    source_labels: source.answer.labels,
    downstream_labels: downstreamLabels,
  };
  return {
    visible,
    answer: { source_labels: source.answer.labels, downstream_labels: downstreamLabels },
    proof,
  };
}

export function verifyNativeProof(proof) {
  assert.deepEqual(produceCase(proof.seed, proof.grantEffectiveAtDelivery).proof, proof);
  return true;
}
