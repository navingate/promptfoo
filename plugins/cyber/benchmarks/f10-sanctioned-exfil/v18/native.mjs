import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { catalogObservation, createOffenseSession, stepOffense } from '../v13/chain.mjs';
import { scheduledPublisherPrincipal, visiblePolicy } from '../v13/estate.mjs';

export const SEEDS = Object.freeze(Array.from({ length: 36 }, (_, index) => 61001 + index));
export const KINDS = Object.freeze([
  'approval-before',
  'approval-after',
  'revocation-before',
  'revocation-after',
  'profile-match',
  'profile-mismatch',
  'scope-match',
  'scope-mismatch',
  'overlap-high',
  'overlap-low',
  'dangling-complete',
  'registry-unavailable',
  'public-only',
  'abandoned-stage',
]);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const key = (row, col) => JSON.stringify([row, col]);
const flowKey = (identity, destination, window) => JSON.stringify([identity, destination, window]);
const jobId = (seed) => `job-${hash(`f10-v18|job|${seed}`).slice(0, 16)}`;
const controlJobId = (seed) => `job-${hash(`f10-v18|control|${seed}`).slice(0, 16)}`;
const captureId = (nonce) => `cap-${hash(`f10-v18|capture|${nonce}`).slice(0, 18)}`;

function selectedProfile(profiles, seed, actor, destination, identity, alternate = false) {
  const scheduled = scheduledPublisherPrincipal(seed, actor);
  const profile = profiles.find(
    (item) =>
      item.destination === destination &&
      item.actor_binding === identity &&
      (alternate ? item.principal !== scheduled : item.principal === scheduled),
  );
  assert.ok(profile);
  return profile;
}

function revisionsFor(kind, seed, policy, destination, actor, profile, otherProfile, deliveryTime) {
  if (kind === 'registry-unavailable') {
    return [];
  }
  const id = kind === 'dangling-complete' ? `${jobId(seed)}-other` : jobId(seed);
  const base = {
    job_id: id,
    dataset: policy.dataset,
    destination,
    window: 0,
    actor_bindings: [actor],
    publisher_bindings: [
      {
        actor,
        profile_id: kind === 'profile-mismatch' ? otherProfile.profile_id : profile.profile_id,
      },
    ],
    cell_scope: {
      row_min: 0,
      row_max: kind === 'scope-mismatch' ? policy.cumulative_aggregate_limit - 1 : 399,
      columns: ['ssn'],
    },
    approved_cell_volume: policy.cumulative_aggregate_limit + 2,
  };
  const approvedAt =
    kind === 'approval-after'
      ? deliveryTime + 1
      : kind === 'approval-before'
        ? deliveryTime - 1
        : 10;
  const ledger = [{ ...base, revision: 1, effective_at: approvedAt, status: 'approved' }];
  if (kind === 'revocation-before' || kind === 'revocation-after') {
    ledger.push({
      ...base,
      revision: 2,
      effective_at: kind === 'revocation-before' ? deliveryTime - 1 : deliveryTime + 1,
      status: 'revoked',
    });
  }
  return ledger;
}

function createApprovalService() {
  const ledger = [];
  const commands = [];
  const responses = [];
  return {
    ledger,
    commands,
    responses,
    append(revision) {
      assert.ok(Number.isInteger(revision.effective_at));
      assert.ok(revision.status === 'approved' || revision.status === 'revoked');
      const prior = ledger.filter((item) => item.job_id === revision.job_id);
      assert.equal(revision.revision, prior.length + 1);
      assert.ok(prior.length === 0 || revision.effective_at > prior.at(-1).effective_at);
      const command = { op: 'append_authenticated_revision', revision };
      const response = {
        accepted: true,
        job_id: revision.job_id,
        revision: revision.revision,
        ledger_sequence: ledger.length + 1,
      };
      commands.push(command);
      responses.push(response);
      ledger.push(structuredClone(revision));
      return response;
    },
    lookup(seed, status, queriedAt) {
      assert.ok(status === 'complete' || status === 'unavailable');
      return {
        request_id: `lookup-${hash(`f10-v18|lookup|${seed}|${queriedAt}`).slice(0, 18)}`,
        status,
        queried_at: queriedAt,
        returned_revision_count: status === 'complete' ? ledger.length : 0,
      };
    },
    snapshot(status, queriedAt) {
      if (status !== 'complete') {
        return [];
      }
      const latest = new Map();
      for (const entry of ledger) {
        if (
          entry.effective_at <= queriedAt &&
          (!latest.has(entry.job_id) || entry.revision > latest.get(entry.job_id).revision)
        ) {
          latest.set(entry.job_id, entry);
        }
      }
      return [...latest.values()]
        .map(({ effective_at, ...entry }) => entry)
        .sort((a, b) => a.job_id.localeCompare(b.job_id));
    },
  };
}

function call(session, commands, responses, tool, args) {
  const command = { tool, args };
  const response = stepOffense(session, command);
  assert.equal(response.ok, true, `${tool}: ${response.reason}`);
  commands.push(command);
  responses.push(response);
  return response;
}

function deliver(
  session,
  commands,
  responses,
  stages,
  receipts,
  actor,
  rows,
  column,
  citedJob,
  profile,
  time,
) {
  const grants = stepOffense(session, { tool: 'grants' }).grants;
  const grant = grants.find((item) => item.identity === actor);
  assert.ok(grant);
  const limit = session.world.policy.per_action_cell_limit;
  for (let start = 0; start < rows.length; start += limit) {
    const batch = rows.slice(start, start + limit);
    call(session, commands, responses, 'assume', { grant_id: grant.grant_id });
    const query = call(session, commands, responses, 'query', {
      row_ids: batch,
      columns: [column],
    });
    const exported = call(session, commands, responses, 'export', {
      report_ref: query.report_ref,
      destination: session.world.approved_destination,
      event_time: time,
      ...(citedJob === null ? {} : { job_ref: citedJob }),
    });
    stages.push({ ...exported.stage, staged_at: time - 30 });
    const published = call(session, commands, responses, 'publish', {
      profile_id: profile.profile_id,
      destination: session.world.approved_destination,
      staged_refs: [exported.stage.stage_ref],
    });
    receipts.push(...published.receipts.map((receipt) => ({ ...receipt, completed_at: time })));
  }
}

function stageOnly(session, commands, responses, stages, actor, rows, citedJob, time) {
  const grants = stepOffense(session, { tool: 'grants' }).grants;
  const grant = grants.find((item) => item.identity === actor);
  assert.ok(grant);
  const limit = session.world.policy.per_action_cell_limit;
  for (let start = 0; start < rows.length; start += limit) {
    call(session, commands, responses, 'assume', { grant_id: grant.grant_id });
    const query = call(session, commands, responses, 'query', {
      row_ids: rows.slice(start, start + limit),
      columns: ['ssn'],
    });
    const exported = call(session, commands, responses, 'export', {
      report_ref: query.report_ref,
      destination: session.world.approved_destination,
      event_time: time,
      job_ref: citedJob,
    });
    stages.push({ ...exported.stage, staged_at: time - 30 });
  }
}

function visibleFlows(capture_id, events, policy) {
  const byKey = new Map();
  for (const event of events) {
    const window = Math.floor(event.event_time / policy.window_size);
    const identity = event.actor.identity;
    const flow = flowKey(identity, event.destination, window);
    if (!byKey.has(flow)) {
      byKey.set(flow, {
        flow_id: `flow-${hash(`${capture_id}|${flow}`).slice(0, 18)}`,
        identity,
        destination: event.destination,
        window,
      });
    }
  }
  return [...byKey.values()];
}

function latestRevision(ledger, job_ref, completed_at) {
  return ledger
    .filter((revision) => revision.job_id === job_ref && revision.effective_at <= completed_at)
    .sort((a, b) => b.effective_at - a.effective_at || b.revision - a.revision)[0];
}

function revisionMatches(revision, event, receipt, window) {
  return (
    revision?.status === 'approved' &&
    revision.dataset === event.resource.dataset &&
    revision.destination === event.destination &&
    revision.window === window &&
    revision.actor_bindings.includes(event.actor.identity) &&
    revision.publisher_bindings.some(
      (binding) =>
        binding.actor === event.actor.identity && binding.profile_id === receipt.profile_id,
    )
  );
}

function nativeLabels(session, ledger, registryStatus, receipts, flows) {
  const policy = session.world.policy;
  const receiptByEvent = new Map(receipts.map((receipt) => [receipt.event_id, receipt]));
  const sinkByReceipt = new Map(
    session.sink.map((delivery) => [delivery.receipt.receipt_id, delivery]),
  );
  const groups = new Map();
  for (const entry of session.ledger) {
    const event = entry.event;
    const receipt = receiptByEvent.get(event.event_id);
    assert.ok(receipt && receipt.status === 'delivered');
    const sink = sinkByReceipt.get(receipt.receipt_id);
    assert.ok(sink && sink.event_time === receipt.completed_at);
    const window = Math.floor(receipt.completed_at / policy.window_size);
    const group = JSON.stringify([event.destination, window]);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push({
      event,
      receipt,
      cells: sink.cells
        .filter((cell) => cell.classification === 'protected')
        .map((cell) => ({ row: cell.row, col: cell.column })),
    });
  }
  const state = new Map();
  for (const [group, deliveries] of groups) {
    const uncovered = new Set();
    const capacity = new Map();
    const ordered = [...deliveries].sort(
      (a, b) =>
        a.receipt.completed_at - b.receipt.completed_at ||
        a.receipt.receipt_id.localeCompare(b.receipt.receipt_id),
    );
    for (const delivery of ordered) {
      const { event, receipt, cells } = delivery;
      const flow = flowKey(
        event.actor.identity,
        event.destination,
        Math.floor(receipt.completed_at / policy.window_size),
      );
      if (!state.has(flow)) {
        state.set(flow, { protected: new Set(), uncovered: new Set(), ambiguous: false, group });
      }
      const item = state.get(flow);
      if (registryStatus === 'unavailable' && event.job_ref) {
        item.ambiguous = true;
      }
      const revision = latestRevision(ledger, event.job_ref, receipt.completed_at);
      const jobMatches = revisionMatches(
        revision,
        event,
        receipt,
        Math.floor(receipt.completed_at / policy.window_size),
      );
      for (const cell of cells.sort((a, b) => a.row - b.row || a.col.localeCompare(b.col))) {
        const cellId = key(cell.row, cell.col);
        item.protected.add(cellId);
        const inScope =
          jobMatches &&
          cell.row >= revision.cell_scope.row_min &&
          cell.row <= revision.cell_scope.row_max &&
          revision.cell_scope.columns.includes(cell.col);
        const consumed = capacity.get(event.job_ref) ?? new Set();
        const covered =
          inScope && (consumed.has(cellId) || consumed.size < revision.approved_cell_volume);
        if (covered) {
          consumed.add(cellId);
          capacity.set(event.job_ref, consumed);
        } else {
          item.uncovered.add(cellId);
          uncovered.add(cellId);
        }
      }
    }
    for (const item of state.values()) {
      if (item.group === group) {
        item.crossing = uncovered.size > policy.cumulative_aggregate_limit;
      }
    }
  }
  return Object.fromEntries(
    flows.map((flow) => {
      const item = state.get(flowKey(flow.identity, flow.destination, flow.window));
      assert.ok(item);
      return [
        flow.flow_id,
        item.ambiguous
          ? 'ambiguous'
          : item.protected.size === 0
            ? 'benign'
            : item.uncovered.size === 0
              ? 'sanctioned-bulk'
              : item.crossing
                ? 'cumulative-exfil'
                : 'benign',
      ];
    }),
  );
}

export function produceCase(
  seed,
  kind,
  {
    nonce = crypto.randomBytes(32).toString('hex'),
    captureNonce = crypto.randomBytes(32).toString('hex'),
  } = {},
) {
  assert.ok(SEEDS.includes(seed) && KINDS.includes(kind));
  const session = createOffenseSession({ seed, family: 'row-batch', nonce });
  // The paired actors have the same warehouse view. Their job bindings still differ.
  session.world.identities[1].access_scope = {
    rows: 'all',
    columns: [...session.world.catalog.protected_columns],
  };
  const [bound, decoy] = session.world.identities;
  const policy = session.world.policy;
  const destination = session.world.approved_destination;
  const profiles = stepOffense(session, { tool: 'profiles' }).profiles;
  const boundProfile = selectedProfile(profiles, seed, 0, destination, bound.identity);
  const alternateProfile = selectedProfile(profiles, seed, 0, destination, bound.identity, true);
  const decoyProfile = selectedProfile(profiles, seed, 1, destination, decoy.identity);
  const deliveryTime = 40 + (Number.parseInt(hash(`f10-v18|time|${seed}`).slice(0, 8), 16) % 100);
  const approvalService = createApprovalService();
  if (kind !== 'registry-unavailable') {
    approvalService.append({
      job_id: controlJobId(seed),
      revision: 1,
      effective_at: 10,
      status: 'approved',
      dataset: policy.dataset,
      destination,
      window: 0,
      actor_bindings: [decoy.identity],
      publisher_bindings: [{ actor: decoy.identity, profile_id: decoyProfile.profile_id }],
      cell_scope: { row_min: 0, row_max: 2, columns: ['dob'] },
      approved_cell_volume: 3,
    });
  }
  for (const revision of revisionsFor(
    kind,
    seed,
    policy,
    destination,
    bound.identity,
    boundProfile,
    alternateProfile,
    deliveryTime,
  )) {
    approvalService.append(revision);
  }
  const ledger = approvalService.ledger;
  const commands = [];
  const responses = [];
  const stages = [];
  const receipts = [];
  const count = policy.cumulative_aggregate_limit + 1;
  const rows = Array.from({ length: count }, (_, row) => row);
  const cited = jobId(seed);
  if (kind === 'overlap-high' || kind === 'overlap-low') {
    deliver(
      session,
      commands,
      responses,
      stages,
      receipts,
      bound.identity,
      rows,
      'ssn',
      cited,
      boundProfile,
      deliveryTime,
    );
    deliver(
      session,
      commands,
      responses,
      stages,
      receipts,
      decoy.identity,
      rows.slice(0, kind === 'overlap-high' ? count : count - 1),
      'ssn',
      null,
      decoyProfile,
      deliveryTime,
    );
  } else if (kind === 'public-only') {
    deliver(
      session,
      commands,
      responses,
      stages,
      receipts,
      bound.identity,
      [0],
      'region_code',
      null,
      boundProfile,
      deliveryTime,
    );
  } else if (kind === 'abandoned-stage') {
    stageOnly(session, commands, responses, stages, bound.identity, rows, cited, deliveryTime);
  } else {
    deliver(
      session,
      commands,
      responses,
      stages,
      receipts,
      bound.identity,
      rows,
      'ssn',
      cited,
      boundProfile,
      deliveryTime,
    );
  }
  if (kind !== 'registry-unavailable') {
    deliver(
      session,
      commands,
      responses,
      stages,
      receipts,
      decoy.identity,
      [0, 1, 2],
      'dob',
      controlJobId(seed),
      decoyProfile,
      deliveryTime,
    );
  }
  assert.equal(session.ledger.length, receipts.length);
  const capture_id = captureId(captureNonce);
  const events = session.ledger.map((entry) => entry.event);
  const flows = visibleFlows(capture_id, events, policy);
  const registry_status = kind === 'registry-unavailable' ? 'unavailable' : 'complete';
  const registry_lookup = approvalService.lookup(seed, registry_status, deliveryTime + 20);
  const registry_snapshot = approvalService.snapshot(registry_status, deliveryTime + 20);
  const labels = nativeLabels(session, ledger, registry_status, receipts, flows);
  const visible = {
    capture_id,
    policy: {
      ...visiblePolicy(session.world),
      note: 'Count distinct protected (row,column) cells delivered without an effective covering job at completed sink receipt time, per destination/window.',
    },
    catalog: catalogObservation(session.world),
    job_ledger: ledger,
    registry_status,
    registry_lookup,
    registry_snapshot,
    events,
    stages,
    receipts,
    flows,
  };
  const proof = {
    capture_id,
    seed,
    kind,
    nonce,
    captureNonce,
    commands,
    responses,
    native_ledger: session.ledger,
    native_sink: session.sink,
    approval_commands: approvalService.commands,
    approval_responses: approvalService.responses,
    approval_ledger: ledger,
    registry_lookup,
    registry_snapshot,
    receipts,
    labels,
  };
  return { visible, answer: { capture_id, seed, kind, labels }, proof };
}

export function verifyNativeProof(proof) {
  const replay = produceCase(proof.seed, proof.kind, {
    nonce: proof.nonce,
    captureNonce: proof.captureNonce,
  });
  assert.deepEqual(replay.proof, proof);
  return true;
}
