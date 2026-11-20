// Native v16 defense holdout. Only the proof carries payloads, labels, and private nonces.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { catalogObservation, createOffenseSession, stepOffense } from '../v13/chain.mjs';
import {
  labelCapture,
  publisherProfileId,
  runExportPlane,
  scheduledPublisherPrincipal,
  visibleEvent,
  visiblePolicy,
} from '../v13/estate.mjs';
import { detect } from '../v15/reference-detector.mjs';

export const SEEDS = Object.freeze(Array.from({ length: 12 }, (_, index) => 41001 + index));
export const KINDS = Object.freeze([
  'covered-overlap',
  'fresh-twin',
  'dangling-citation',
  'bound-control',
]);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomNonce = () => crypto.randomBytes(32).toString('hex');
const captureId = (captureNonce) => `cap-${hash(`f10-v16|capture|${captureNonce}`).slice(0, 18)}`;

function jobFor(world, seed) {
  const actor = world.identities[0].identity;
  const destination = world.approved_destination;
  return {
    job_id: `job-${hash(`f10-v16|job|${seed}`).slice(0, 16)}`,
    approval_ref: `apr-${hash(`f10-v16|approval|${seed}`).slice(0, 16)}`,
    dataset: world.policy.dataset,
    destination,
    window: 0,
    approved_cell_volume: 1,
    actor_binding: [actor],
    publisher_bindings: [
      {
        actor,
        profile_id: publisherProfileId(
          seed,
          destination,
          actor,
          scheduledPublisherPrincipal(seed, 0),
        ),
      },
    ],
    purpose: seed % 2 ? 'scheduled-migration' : 'bounded-migration',
  };
}

function flowsFromEvents(id, events, policy) {
  const flows = new Map();
  for (const event of events) {
    const identity = event.actor.identity;
    const destination = event.destination;
    const window = Math.floor(event.event_time / policy.window_size);
    const key = JSON.stringify([identity, destination, window]);
    if (!flows.has(key)) {
      flows.set(key, {
        flow_id: `flow-${hash(`${id}|${key}`).slice(0, 18)}`,
        identity,
        destination,
        window,
      });
    }
  }
  return [...flows.values()];
}

function labelsFor(flows, truth) {
  return Object.fromEntries(
    flows.map((flow) => {
      const match = truth.find(
        (item) =>
          item.identity === flow.identity &&
          item.destination === flow.destination &&
          item.window === flow.window,
      );
      assert.ok(match, `missing native label for ${flow.flow_id}`);
      return [flow.flow_id, match.label];
    }),
  );
}

function execute(session, identity, column, jobRef, grants, profiles, commands, responses) {
  const destination = session.world.approved_destination;
  const grant = grants.find((item) => item.identity === identity);
  const profile = profiles.find(
    (item) =>
      item.destination === destination &&
      item.actor_binding === identity &&
      item.principal ===
        scheduledPublisherPrincipal(
          session.world.meta.seed,
          session.world.identities.findIndex((actor) => actor.identity === identity),
        ),
  );
  assert.ok(grant && profile);
  const call = (tool, args) => {
    const command = { tool, args };
    const result = stepOffense(session, command);
    assert.equal(result.ok, true, `${tool}: ${result.reason}`);
    commands.push(command);
    responses.push(result);
    return result;
  };
  call('assume', { grant_id: grant.grant_id });
  const query = call('query', { row_ids: [0], columns: [column] });
  const exported = call('export', {
    report_ref: query.report_ref,
    destination,
    event_time: 1,
    ...(jobRef === null ? {} : { job_ref: jobRef }),
  });
  call('publish', {
    profile_id: profile.profile_id,
    destination,
    staged_refs: [exported.stage.stage_ref],
  });
  return exported.stage;
}

export function produceCase(
  seed,
  kind,
  { nonce = randomNonce(), captureNonce = randomNonce() } = {},
) {
  if (!SEEDS.includes(seed) || !KINDS.includes(kind)) {
    throw new Error('unknown v16 capture seed or kind');
  }
  assert.ok(typeof nonce === 'string' && nonce.length > 0, 'invalid session nonce');
  assert.ok(typeof captureNonce === 'string' && captureNonce.length > 0, 'invalid capture nonce');
  const spec = { seed, family: 'multi-identity-fanout', nonce };
  const world = createOffenseSession(spec).world;
  const job = jobFor(world, seed);
  const session = createOffenseSession({ ...spec, extraJobs: [job] });
  const [bound, , decoy] = session.world.identities;
  assert.ok(bound.access_scope.columns.includes('ssn'));
  assert.ok(decoy.access_scope.columns.includes('ssn'));
  assert.ok(decoy.access_scope.columns.includes('full_name'));
  const profiles = stepOffense(session, { tool: 'profiles' }).profiles;
  const grants = stepOffense(session, { tool: 'grants' }).grants;
  const commands = [];
  const responses = [];
  const stages = [];
  if (kind !== 'dangling-citation') {
    stages.push(
      execute(session, bound.identity, 'ssn', job.job_id, grants, profiles, commands, responses),
    );
  }
  if (kind !== 'bound-control') {
    stages.push(
      execute(
        session,
        decoy.identity,
        kind === 'fresh-twin' ? 'full_name' : 'ssn',
        kind === 'dangling-citation'
          ? `job-${hash(`f10-v16|dangling|${seed}`).slice(0, 16)}`
          : null,
        grants,
        profiles,
        commands,
        responses,
      ),
    );
  }

  const replay = runExportPlane(session.actions, session.world);
  assert.equal(replay.blocked.length, 0);
  assert.equal(replay.events.length, session.ledger.length);
  assert.equal(session.sink.length, session.ledger.length);
  const events = session.ledger.map((entry) => entry.event);
  assert.deepEqual(events, replay.events.map(visibleEvent));
  const receipts = session.ledger.map((entry) => entry.receipt);
  const capture_id = captureId(captureNonce);
  const flows = flowsFromEvents(capture_id, events, session.world.policy);
  const truth = labelCapture(replay.events, session.world.job_registry, session.world.policy);
  assert.equal(flows.length, truth.length);
  const labels = labelsFor(flows, truth);
  const visible = {
    capture_id,
    policy: visiblePolicy(session.world),
    catalog: catalogObservation(session.world),
    job_registry: session.world.job_registry.map((item) => ({ ...item })),
    publisher_profiles: profiles,
    stages,
    events,
    receipts,
    flows,
  };
  assert.deepEqual(detect(visible), labels);
  const proof = {
    capture_id,
    captureNonce,
    kind,
    spec,
    extraJobs: [job],
    commands,
    responses,
    native_actions: session.actions,
    ledger: session.ledger,
    sink: session.sink,
    labels,
  };
  return { visible, answer: { capture_id, seed, kind, labels }, proof };
}

export function verifyNativeProof(proof) {
  assert.deepEqual(
    proof,
    produceCase(proof.spec.seed, proof.kind, {
      nonce: proof.spec.nonce,
      captureNonce: proof.captureNonce,
    }).proof,
  );
  const session = createOffenseSession({ ...proof.spec, extraJobs: proof.extraJobs });
  assert.equal(proof.commands.length, proof.responses.length);
  for (let index = 0; index < proof.commands.length; index += 1) {
    assert.deepEqual(stepOffense(session, proof.commands[index]), proof.responses[index]);
  }
  const replay = runExportPlane(session.actions, session.world);
  assert.deepEqual(session.actions, proof.native_actions);
  assert.deepEqual(session.ledger, proof.ledger);
  assert.deepEqual(session.sink, proof.sink);
  assert.deepEqual(
    session.ledger.map((item) => item.event),
    replay.events.map(visibleEvent),
  );
  assert.deepEqual(
    session.ledger.map((item) => item.receipt),
    proof.ledger.map((item) => item.receipt),
  );
  for (const delivery of session.sink) {
    for (const cell of delivery.cells) {
      assert.equal(
        cell.value,
        hash(`${proof.spec.nonce}|${proof.spec.seed}|${cell.row}|${cell.column}`).slice(0, 24),
      );
    }
  }
  const flows = flowsFromEvents(
    proof.capture_id,
    session.ledger.map((item) => item.event),
    session.world.policy,
  );
  const truth = labelCapture(replay.events, session.world.job_registry, session.world.policy);
  assert.deepEqual(labelsFor(flows, truth), proof.labels);
  return true;
}

export function buildCorpus(seeds = SEEDS) {
  assert.ok(Array.isArray(seeds) && seeds.every((seed) => SEEDS.includes(seed)));
  return seeds.flatMap((seed) => {
    const twinNonce = randomNonce();
    return KINDS.map((kind) =>
      produceCase(seed, kind, {
        nonce: kind === 'covered-overlap' || kind === 'fresh-twin' ? twinNonce : randomNonce(),
        captureNonce: randomNonce(),
      }),
    );
  });
}
