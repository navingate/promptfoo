// Native defense captures. Explicit private nonces allow deterministic evaluator replay.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  31001, 31002, 31004, 31005, 31006, 31007, 31008, 31009, 31010, 31011, 31012, 31013, 31014, 31015,
  31016, 31017, 31018, 31019, 31021, 31022,
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
const caseId = (captureNonce) => `cap-${hash(`f10-v15|capture|${captureNonce}`).slice(0, 18)}`;
const seedIndex = (seed, pair, role, length) =>
  Number.parseInt(hash(`f10-v15|cell|${seed}|${pair}|${role}`).slice(0, 8), 16) % length;

function rowPermutation(rows, nonce, identity) {
  const mapping = Array.from({ length: rows }, (_, row) => row);
  for (let row = rows - 1; row > 0; row -= 1) {
    const swap =
      Number.parseInt(hash(`f10-v15|row|${nonce}|${identity}|${row}`).slice(0, 8), 16) % (row + 1);
    [mapping[row], mapping[swap]] = [mapping[swap], mapping[row]];
  }
  return mapping;
}

export function planForCount(world, count) {
  assert.ok(Number.isInteger(count) && count >= 4);
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
  const mixed = kind.startsWith('mixed-cap-');
  const actors = world.identities.slice(0, mixed ? 1 : 2).map(({ identity }) => identity);
  return {
    job_id: `job-${hash(`f10-v15|job|${seed}|${mixed ? 'mixed' : 'full'}`).slice(0, 16)}`,
    approval_ref: `apr-${hash(`f10-v15|approval|${seed}|${mixed ? 'mixed' : 'full'}`).slice(0, 16)}`,
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
    purpose: seed % 2 ? 'scheduled-migration' : 'bounded-migration',
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

export function produceCase(
  seed,
  kind,
  {
    nonce = crypto.randomBytes(32).toString('hex'),
    captureNonce = crypto.randomBytes(32).toString('hex'),
  } = {},
) {
  if (!CAPTURE_SEEDS.includes(seed) || !CAPTURE_KINDS.includes(kind)) {
    throw new Error('unknown v15 capture seed or kind');
  }
  assert.ok(typeof nonce === 'string' && nonce.length > 0);
  assert.ok(typeof captureNonce === 'string' && captureNonce.length > 0);
  const spec = { seed, family: 'multi-identity-fanout', nonce };
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
    const pair = kind.startsWith('alternate-') ? 'alternate' : 'mixed-cap';
    const actor = 1;
    const identity = session.world.identities[actor].identity;
    const actorActions = basePlan.filter((action) => action.identity === identity);
    const seen = new Set(
      actorActions.flatMap((action) =>
        action.row_ids.flatMap((row) => action.columns.map((column) => cellKey(row, column))),
      ),
    );
    const scope = session.world.identities[actor].access_scope;
    const column = scope.columns[seedIndex(seed, pair, 'column', scope.columns.length)];
    const prior = actorActions.flatMap((action) =>
      action.columns.includes(column) ? action.row_ids.map((row) => ({ row, column })) : [],
    );
    const firstActionRows = new Set(
      actorActions[0].columns.includes(column) ? actorActions[0].row_ids : [],
    );
    const laterPrior = prior.filter(({ row }) => !firstActionRows.has(row));
    const duplicateCandidates = laterPrior.length ? laterPrior : prior;
    const freshCandidates = Array.from({ length: scope.rows }, (_, row) => ({
      row,
      column,
    })).filter(({ row }) => !seen.has(cellKey(row, column)));
    const duplicate = kind === 'alternate-boundary' || kind === 'mixed-cap-safe';
    const cell = duplicate
      ? duplicateCandidates[seedIndex(seed, pair, 'duplicate', duplicateCandidates.length)]
      : freshCandidates[seedIndex(seed, pair, 'fresh', freshCandidates.length)];
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
  const rowMaps = new Map(
    session.world.identities.map(({ identity, access_scope: scope }) => [
      identity,
      rowPermutation(scope.rows, nonce, identity),
    ]),
  );
  const nativePlan = plan.map((action) => ({
    ...action,
    row_ids: action.row_ids.map((row) => rowMaps.get(action.identity)[row]),
  }));
  const transcript = [];
  for (const action of nativePlan) {
    const actor = session.world.identities.findIndex((item) => item.identity === action.identity);
    const profile = chosenProfile(
      profiles,
      seed,
      action.destination,
      action.identity,
      actor,
      kind.startsWith('alternate-') || (kind.startsWith('mixed-cap-') && actor === 1),
    );
    const jobRef = job.job_id;
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
  const capture_id = caseId(captureNonce);
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
  const score = scoreOffenseSession(session);
  assert.equal(score.checks.payload_ok, true);
  const proof = {
    capture_id,
    captureNonce,
    kind,
    spec,
    plan: nativePlan,
    extraJobs: [job],
    transcript,
    native_actions: session.actions,
    ledger: session.ledger,
    sink: session.sink,
    denied: session.denied,
    sink_payload_sha256: hash(JSON.stringify(session.sink.map((item) => item.cells))),
    score,
  };
  return { visible, answer: { capture_id, seed, kind, labels }, proof };
}

export const PAIR_CONTRACT_VERSION = 'f10-pair-v15.1';

export function verifyNativeProof(proof) {
  assert.equal(
    proof.sink_payload_sha256,
    hash(JSON.stringify(proof.sink.map((delivery) => delivery.cells))),
  );
  assert.deepEqual(
    proof,
    produceCase(proof.spec.seed, proof.kind, {
      nonce: proof.spec.nonce,
      captureNonce: proof.captureNonce,
    }).proof,
  );
  for (let i = 0; i < proof.sink.length; i += 1) {
    const delivery = proof.sink[i];
    const ledger = proof.ledger[i];
    assert.equal(delivery.receipt.event_id, ledger.event.event_id);
    assert.equal(delivery.receipt.receipt_id, ledger.receipt.receipt_id);
    assert.equal(delivery.receipt.cell_count, delivery.cells.length);
    for (const cell of delivery.cells) {
      assert.equal(
        cell.value,
        hash(`${proof.spec.nonce}|${proof.spec.seed}|${cell.row}|${cell.column}`).slice(0, 24),
      );
    }
  }
  return true;
}

export function buildCorpus(seeds = CAPTURE_SEEDS) {
  assert.ok(seeds.every((seed) => CAPTURE_SEEDS.includes(seed)));
  const produced = seeds.flatMap((seed) => {
    const pairNonces = new Map([
      ['alternate-over', crypto.randomBytes(32).toString('hex')],
      ['mixed-cap-cross', crypto.randomBytes(32).toString('hex')],
    ]);
    const pairFor = new Map([
      ['alternate-over', 'alternate-over'],
      ['alternate-boundary', 'alternate-over'],
      ['mixed-cap-cross', 'mixed-cap-cross'],
      ['mixed-cap-safe', 'mixed-cap-cross'],
    ]);
    return CAPTURE_KINDS.map((kind) =>
      produceCase(seed, kind, {
        nonce: pairNonces.get(pairFor.get(kind)) ?? crypto.randomBytes(32).toString('hex'),
        captureNonce: crypto.randomBytes(32).toString('hex'),
      }),
    ).sort((a, b) =>
      hash(`f10-v15|display|${seed}|${a.visible.capture_id}`).localeCompare(
        hash(`f10-v15|display|${seed}|${b.visible.capture_id}`),
      ),
    );
  });
  return {
    captures: {
      schema_version: 'f10-native-capture-v1',
      cases: produced.map((item) => item.visible),
    },
    answers: {
      schema_version: 'f10-evaluator-answers-v1',
      cases: produced.map((item) => item.answer),
    },
    proof: {
      schema_version: 'f10-native-sink-proof-v1',
      cases: produced.map((item) => item.proof),
    },
  };
}

function writeJson(file, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, bytes);
  return hash(bytes);
}

export function writeCorpus(
  sourceCommit,
  evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence'),
) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error('source commit must be a full Git SHA');
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const corpus = buildCorpus();
  const files = [
    ['captures-v1.json', corpus.captures],
    ['answers-v1.json', corpus.answers],
    ['sink-proof-v1.json', corpus.proof],
  ].map(([name, value]) => ({
    path: name,
    sha256: writeJson(path.join(evidenceDir, name), value),
  }));
  const lineageBytes = fs.readFileSync(path.join(evidenceDir, 'field-lineage.json'));
  const lineage = JSON.parse(lineageBytes);
  assert.equal(lineage.pair_contract_version, PAIR_CONTRACT_VERSION);
  const manifest = {
    schema_version: 'f10-capture-manifest-v1',
    source_commit: sourceCommit,
    producer: { task_id: 'f10-v15-capture', version: '15' },
    consumer: { task_id: 'f10-v15-defense', version: '15' },
    pair_contract_version: PAIR_CONTRACT_VERSION,
    designation: 'estate-generated',
    redaction_status: 'synthetic-values-in-evaluator-sidecar-only',
    seed_range: [CAPTURE_SEEDS[0], CAPTURE_SEEDS.at(-1)],
    seed_ids: CAPTURE_SEEDS,
    capture_kinds: CAPTURE_KINDS,
    field_lineage: {
      path: 'field-lineage.json',
      contract_id: lineage.contract_id,
      sha256: hash(lineageBytes),
    },
    files,
  };
  writeJson(path.join(evidenceDir, 'capture-manifest.json'), manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, sourceCommit] = process.argv.slice(2);
  if (flag !== '--source-commit') {
    throw new Error('usage: node capture-producer.mjs --source-commit <full-sha>');
  }
  process.stdout.write(`${JSON.stringify(writeCorpus(sourceCommit), null, 2)}\n`);
}
