// Deterministic native defense captures. Only `visible` belongs in model observations.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  catalogObservation,
  createOffenseSession,
  scoreOffenseSession,
  stepOffense,
} from '../v13/chain.mjs';
import {
  labelCapture,
  publisherProfileId,
  runExportPlane,
  scheduledPublisherPrincipal,
  visiblePolicy,
} from '../v13/estate.mjs';

export const CAPTURE_SEEDS = [
  ...Array.from({ length: 12 }, (_, i) => 14001 + i),
  ...Array.from({ length: 8 }, (_, i) => 14101 + i),
];
export const CAPTURE_KINDS = [
  'bound-bulk',
  'alternate-over',
  'alternate-boundary',
  'mixed-cap-safe',
  'mixed-cap-cross',
  'duplicate-covered',
  'owner-denied',
];

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cellKey = (row, column) => `${row}|${column}`;
const caseId = (seed, kind) => `cap-${hash(`f10-v14|capture|${seed}|${kind}`).slice(0, 18)}`;

export function planForCount(world, count) {
  assert.ok(Number.isInteger(count) && count >= 2);
  const identities = world.identities.slice(0, 2);
  const minFirst = Math.max(
    2 * Math.floor(count / 4),
    count - (2 * identities[1].access_scope.rows - 1),
  );
  const first = 2 * Math.ceil(minFirst / 2);
  const counts = [first, count - first];
  const plan = [];
  for (let actor = 0; actor < 2; actor += 1) {
    const { identity, access_scope: scope } = identities[actor];
    const [first, second] = scope.columns;
    assert.ok(first && second && Number.isInteger(scope.rows));
    const fullRows = Math.floor(counts[actor] / 2);
    assert.ok(fullRows + (counts[actor] % 2) <= scope.rows);
    const rowsPerAction = Math.floor(world.policy.per_action_cell_limit / 2);
    for (let row = 0; row < fullRows; row += rowsPerAction) {
      plan.push({
        identity,
        row_ids: Array.from({ length: Math.min(rowsPerAction, fullRows - row) }, (_, i) => row + i),
        columns: [first, second],
        destination: world.approved_destination,
        event_time: 1,
      });
    }
    if (counts[actor] % 2) {
      plan.push({
        identity,
        row_ids: [fullRows],
        columns: [first],
        destination: world.approved_destination,
        event_time: 1,
      });
    }
  }
  const cells = new Set(
    plan.flatMap((action) =>
      action.row_ids.flatMap((row) => action.columns.map((column) => cellKey(row, column))),
    ),
  );
  assert.equal(cells.size, count);
  assert.equal(new Set(plan.map((action) => action.identity)).size, 2);
  assert.ok(
    plan.every(
      (action) =>
        action.row_ids.length * action.columns.length <= world.policy.per_action_cell_limit,
    ),
  );
  return plan;
}

function jobFor(world, seed, kind) {
  const full = kind === 'bound-bulk' || kind === 'duplicate-covered';
  const mixed = kind.startsWith('mixed-cap-');
  const actors = world.identities.slice(0, mixed ? 1 : 2).map(({ identity }) => identity);
  return {
    job_id: `job-${hash(`f10-v14|job|${seed}|${mixed ? 'mixed' : 'full'}`).slice(0, 16)}`,
    approval_ref: `apr-${hash(`f10-v14|approval|${seed}|${mixed ? 'mixed' : 'full'}`).slice(0, 16)}`,
    dataset: world.policy.dataset,
    destination: world.approved_destination,
    window: 0,
    approved_cell_volume: mixed ? 3 : world.policy.cumulative_aggregate_limit + 6,
    actor_binding: actors,
    publisher_bindings: actors.map((actor, index) => ({
      actor,
      profile_id: publisherProfileId(
        seed,
        world.approved_destination,
        actor,
        scheduledPublisherPrincipal(seed, index),
      ),
    })),
    purpose: full ? 'scheduled-migration' : 'bounded-migration',
  };
}

function chosenProfile(profiles, seed, destination, identity, actor, alternate = false) {
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

function execute(session, action, profile, jobRef, grants) {
  const grant = grants.find((item) => item.identity === action.identity);
  assert.ok(grant);
  const assumed = stepOffense(session, { tool: 'assume', args: { grant_id: grant.grant_id } });
  assert.equal(assumed.ok, true);
  const query = stepOffense(session, {
    tool: 'query',
    args: { row_ids: action.row_ids, columns: action.columns },
  });
  assert.equal(query.ok, true);
  const exported = stepOffense(session, {
    tool: 'export',
    args: {
      report_ref: query.report_ref,
      destination: action.destination,
      event_time: action.event_time,
      job_ref: jobRef,
    },
  });
  assert.equal(exported.ok, true);
  const publishArgs = {
    profile_id: profile.profile_id,
    destination: action.destination,
    staged_refs: [exported.stage.stage_ref],
  };
  const published = stepOffense(session, { tool: 'publish', args: publishArgs });
  return { assumed, query, export: exported, publish_args: publishArgs, publish: published };
}

function flowsFromEvents(captureId, events, policy) {
  const seen = new Map();
  for (const event of events) {
    const identity = event.actor.identity;
    const destination = event.destination;
    const window = Math.floor(event.event_time / policy.window_size);
    const key = `${identity}|${destination}|${window}`;
    if (!seen.has(key)) {
      seen.set(key, {
        flow_id: `flow-${hash(`${captureId}|${key}`).slice(0, 18)}`,
        identity,
        destination,
        window,
      });
    }
  }
  return [...seen.values()];
}

export function produceCase(seed, kind) {
  if (!CAPTURE_SEEDS.includes(seed) || !CAPTURE_KINDS.includes(kind)) {
    throw new Error('unknown v14 capture seed or kind');
  }
  const spec = {
    seed,
    family: 'multi-identity-fanout',
    nonce: hash(`f10-v14|nonce|${seed}|${kind}`),
  };
  const world = createOffenseSession(spec).world;
  const A = world.policy.cumulative_aggregate_limit;
  const job = jobFor(world, seed, kind);
  const session = createOffenseSession({ ...spec, extraJobs: [job] });
  const profiles = stepOffense(session, { tool: 'profiles' }).profiles;
  const grants = stepOffense(session, { tool: 'grants' }).grants;
  const baseCount = kind.startsWith('alternate-')
    ? A
    : kind.startsWith('mixed-cap-')
      ? A + 3
      : A + 1;
  const basePlan = planForCount(session.world, baseCount);
  const plan = kind === 'owner-denied' ? basePlan.slice(0, 1) : [...basePlan];
  if (kind.startsWith('alternate-') || kind.startsWith('mixed-cap-')) {
    const actor = 1;
    const identity = session.world.identities[actor].identity;
    const actorActions = basePlan.filter((action) => action.identity === identity);
    const seen = new Set(
      actorActions.flatMap((action) =>
        action.row_ids.flatMap((row) => action.columns.map((column) => cellKey(row, column))),
      ),
    );
    const scope = session.world.identities[actor].access_scope;
    const duplicate = kind === 'alternate-boundary' || kind === 'mixed-cap-safe';
    const cell = duplicate
      ? { row: actorActions[0].row_ids[0], column: actorActions[0].columns[0] }
      : Array.from({ length: scope.rows }, (_, row) => row)
          .flatMap((row) => scope.columns.map((column) => ({ row, column })))
          .find(({ row, column }) => !seen.has(cellKey(row, column)));
    assert.ok(cell);
    plan.push({
      identity,
      row_ids: [cell.row],
      columns: [cell.column],
      destination: session.world.approved_destination,
      event_time: 1,
    });
  }
  if (kind === 'duplicate-covered') {
    plan.push({
      ...basePlan[0],
      row_ids: [...basePlan[0].row_ids],
      columns: [...basePlan[0].columns],
    });
  }
  const transcript = [];
  for (const action of plan) {
    const actor = session.world.identities.findIndex((item) => item.identity === action.identity);
    const profile = chosenProfile(
      profiles,
      seed,
      action.destination,
      action.identity,
      actor,
      kind.startsWith('alternate-') || (kind.startsWith('mixed-cap-') && actor === 1),
    );
    const jobRef =
      kind === 'bound-bulk' ||
      kind === 'duplicate-covered' ||
      (kind.startsWith('mixed-cap-') && actor === 0)
        ? job.job_id
        : null;
    if (kind === 'owner-denied') {
      const wrong = profiles.find(
        (item) => item.destination === action.destination && item.actor_binding !== action.identity,
      );
      transcript.push(execute(session, action, wrong, jobRef, grants));
      assert.equal(transcript.at(-1).publish.reason, 'publisher-owner-mismatch');
    } else {
      transcript.push(execute(session, action, profile, jobRef, grants));
      assert.equal(transcript.at(-1).publish.ok, true);
    }
  }
  const capture_id = caseId(seed, kind);
  const events = session.ledger.map((item) => item.event);
  const receipts = session.ledger.map((item) => item.receipt);
  const replay = runExportPlane(session.actions, session.world);
  assert.deepEqual(
    events,
    replay.events.map(({ _delivered, _publisher_profile_id, ...native }) => native),
  );
  const flows = flowsFromEvents(capture_id, events, session.world.policy);
  const truth = labelCapture(replay.events, session.world.job_registry, session.world.policy);
  assert.equal(flows.length, truth.length);
  const labels = Object.fromEntries(
    flows.map((flow) => {
      const match = truth.find(
        (item) =>
          item.identity === flow.identity &&
          item.destination === flow.destination &&
          item.window === flow.window,
      );
      assert.ok(match);
      return [flow.flow_id, match.label];
    }),
  );
  const visible = {
    capture_id,
    policy: visiblePolicy(session.world),
    catalog: catalogObservation(session.world),
    job_registry: session.world.job_registry.map((item) => ({ ...item })),
    publisher_profiles: profiles,
    stages: transcript.map((item) => item.export.stage),
    blocked_publish_attempts: transcript
      .filter((item) => item.publish.reason === 'publisher-owner-mismatch')
      .map((item) => ({ ...item.publish_args, reason: item.publish.reason })),
    events,
    receipts,
    flows,
    denied_count: session.denied.length,
  };
  const proof = {
    capture_id,
    kind,
    spec,
    plan,
    extraJobs: [job],
    transcript,
    native_actions: session.actions,
    ledger: session.ledger,
    sink: session.sink,
    denied: session.denied,
    sink_payload_sha256: hash(JSON.stringify(session.sink.map((item) => item.cells))),
    score: scoreOffenseSession(session),
  };
  return { visible, answer: { capture_id, seed, kind, labels }, proof };
}
