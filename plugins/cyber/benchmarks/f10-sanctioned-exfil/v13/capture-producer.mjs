#!/usr/bin/env node
// Deterministic estate-generated native captures. Only `visible` is staged for the detector.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { labelCapture, referencePlan, runExportPlane, visiblePolicy } from '../shared/estate.mjs';
import {
  catalogObservation,
  createOffenseSession,
  drivePlan,
  scoreOffenseSession,
  stepOffense,
} from './chain.mjs';

export const CAPTURE_SEEDS = Array.from({ length: 12 }, (_, i) => 13001 + i);
export const CAPTURE_KINDS = [
  'malicious-fanout',
  'covered-fanout',
  'wrong-bound-job',
  'below-limit',
  'blocked-oversize',
  'publisher-mismatch',
];
export const PAIR_CONTRACT_VERSION = 'f10-pair-v13.1';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nonceFor = (seed, kind) => hash(`f10-v13|nonce|${seed}|${kind}`);
const idFor = (seed, kind) => `cap-${hash(`f10-v13|capture|${seed}|${kind}`).slice(0, 18)}`;
const range = (end) => Array.from({ length: end }, (_, i) => i);

function coveringJob(world, seed) {
  return {
    job_id: `job-${hash(`f10-v6|job|${seed}`).slice(0, 16)}`,
    approval_ref: `apr-${hash(`f10-v6|approval|${seed}`).slice(0, 16)}`,
    dataset: world.policy.dataset,
    destination: world.approved_destination,
    window: 0,
    approved_cell_volume: world.policy.cumulative_aggregate_limit * 4,
    actor_binding: world.identities.slice(0, 2).map(({ identity }) => identity),
    purpose: 'scheduled-migration',
  };
}

function wrongBoundJob(world, seed) {
  return {
    ...coveringJob(world, seed),
    job_id: `job-${hash(`f10-v6|wrong-job|${seed}`).slice(0, 16)}`,
    actor_binding: [world.identities[2].identity],
  };
}

function blockedExecution(spec) {
  const session = createOffenseSession(spec);
  const grant = stepOffense(session, { tool: 'grants' }).grants.find(
    (candidate) => candidate.access_scope.rows === 'all',
  );
  assert.ok(grant);
  const catalog = stepOffense(session, { tool: 'catalog' }).catalog;
  const assumed = stepOffense(session, { tool: 'assume', args: { grant_id: grant.grant_id } });
  const plan = [
    {
      identity: grant.identity,
      row_ids: range(20),
      columns: catalog.protected_columns,
      destination: session.world.destinations[0],
      event_time: 1,
    },
  ];
  const query = stepOffense(session, {
    tool: 'query',
    args: { row_ids: plan[0].row_ids, columns: plan[0].columns },
  });
  const exported = query.ok
    ? stepOffense(session, {
        tool: 'export',
        args: { report_ref: query.report_ref, destination: plan[0].destination, event_time: 1 },
      })
    : { ok: false, reason: 'query-failed' };
  assert.equal(assumed.ok, true);
  assert.equal(query.ok, true);
  assert.equal(exported.reason, 'per-action-export-limit');
  return {
    session,
    transcript: [{ assumed, query, export: exported }],
    plan,
    jobRef: null,
    extraJobs: [],
  };
}

function completedExecution(spec, kind) {
  const world = createOffenseSession(spec).world;
  const fullPlan = referencePlan(world);
  const plan = kind === 'below-limit' ? fullPlan.slice(0, -1) : fullPlan;
  const job =
    kind === 'covered-fanout'
      ? coveringJob(world, spec.seed)
      : kind === 'wrong-bound-job'
        ? wrongBoundJob(world, spec.seed)
        : null;
  const extraJobs = job ? [job] : [];
  const jobRef = job?.job_id ?? null;
  const execution = drivePlan({ ...spec, extraJobs }, plan, jobRef);
  return { ...execution, plan, jobRef, extraJobs };
}

function publisherMismatchExecution(spec) {
  const session = createOffenseSession(spec);
  const action = referencePlan(session.world)[0];
  const grant = stepOffense(session, { tool: 'grants' }).grants.find(
    (candidate) => candidate.identity === action.identity,
  );
  assert.ok(grant);
  const assumed = stepOffense(session, { tool: 'assume', args: { grant_id: grant.grant_id } });
  const query = stepOffense(session, {
    tool: 'query',
    args: { row_ids: action.row_ids, columns: action.columns },
  });
  const exported = stepOffense(session, {
    tool: 'export',
    args: {
      report_ref: query.report_ref,
      destination: action.destination,
      event_time: action.event_time,
    },
  });
  const profile = stepOffense(session, { tool: 'profiles' }).profiles.find(
    (candidate) =>
      candidate.destination === action.destination && candidate.actor_binding !== action.identity,
  );
  assert.ok(profile);
  const publishArgs = {
    profile_id: profile.profile_id,
    destination: action.destination,
    staged_refs: [exported.stage.stage_ref],
  };
  const published = stepOffense(session, { tool: 'publish', args: publishArgs });
  assert.equal(assumed.ok, true);
  assert.equal(query.ok, true);
  assert.equal(exported.ok, true);
  assert.equal(published.reason, 'publisher-owner-mismatch');
  assert.equal(session.sink.length, 0);
  return {
    session,
    transcript: [
      { assumed, query, export: exported },
      { publish_args: publishArgs, publish: published },
    ],
    plan: [action],
    jobRef: null,
    extraJobs: [],
  };
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
    throw new Error('unknown v13 capture seed or kind');
  }
  const spec = {
    seed,
    family: kind === 'blocked-oversize' ? 'row-batch' : 'multi-identity-fanout',
    nonce: nonceFor(seed, kind),
  };
  const execution =
    kind === 'blocked-oversize'
      ? blockedExecution(spec)
      : kind === 'publisher-mismatch'
        ? publisherMismatchExecution(spec)
        : completedExecution(spec, kind);
  const { session, plan, extraJobs, jobRef, transcript } = execution;
  const capture_id = idFor(seed, kind);
  const events = session.ledger.map((entry) => entry.event);
  const receipts = session.ledger.map((entry) => entry.receipt);
  const replay = runExportPlane(session.actions, session.world);
  assert.deepEqual(
    events,
    replay.events.map(({ _delivered, ...native }) => native),
  );
  const flows = flowsFromEvents(capture_id, events, session.world.policy);
  const truth = labelCapture(replay.events, session.world.job_registry, session.world.policy);
  assert.equal(flows.length, truth.length);
  const labels = Object.fromEntries(
    flows.map((flow) => {
      const found = truth.find(
        (item) =>
          item.identity === flow.identity &&
          item.destination === flow.destination &&
          item.window === flow.window,
      );
      assert.ok(found, `missing native truth for ${flow.flow_id}`);
      return [flow.flow_id, found.label];
    }),
  );
  const visible = {
    capture_id,
    policy: visiblePolicy(session.world),
    catalog: catalogObservation(session.world),
    job_registry: session.world.job_registry.map((job) => ({ ...job })),
    publisher_profiles: stepOffense(session, { tool: 'profiles' }).profiles,
    stages: transcript.flatMap((entry) => (entry.export?.ok ? [entry.export.stage] : [])),
    blocked_publish_attempts: transcript.flatMap((entry) =>
      entry.publish?.reason === 'publisher-owner-mismatch'
        ? [{ ...entry.publish_args, reason: entry.publish.reason }]
        : [],
    ),
    events,
    receipts,
    flows,
    denied_count: session.denied.length,
  };
  const score = scoreOffenseSession(session);
  const proof = {
    capture_id,
    kind,
    spec,
    plan,
    extraJobs,
    jobRef,
    transcript,
    native_actions: session.actions,
    ledger: session.ledger,
    sink: session.sink,
    denied: session.denied,
    sink_payload_sha256: hash(JSON.stringify(session.sink.map((delivery) => delivery.cells))),
    score,
  };
  return { visible, answer: { capture_id, seed, kind, labels }, proof };
}

export function verifyNativeProof(proof) {
  assert.equal(
    proof.sink_payload_sha256,
    hash(JSON.stringify(proof.sink.map((delivery) => delivery.cells))),
  );
  assert.deepEqual(proof, produceCase(proof.spec.seed, proof.kind).proof);
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

export function buildCorpus() {
  const produced = CAPTURE_SEEDS.flatMap((seed) =>
    CAPTURE_KINDS.map((kind) => produceCase(seed, kind)).sort((a, b) =>
      hash(`f10-v13|display|${seed}|${a.visible.capture_id}`).localeCompare(
        hash(`f10-v13|display|${seed}|${b.visible.capture_id}`),
      ),
    ),
  );
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
  const lineagePath = path.join(evidenceDir, 'field-lineage.json');
  const lineageBytes = fs.readFileSync(lineagePath);
  const lineage = JSON.parse(lineageBytes);
  assert.equal(lineage.pair_contract_version, PAIR_CONTRACT_VERSION);
  const manifest = {
    schema_version: 'f10-capture-manifest-v1',
    source_commit: sourceCommit,
    producer: { task_id: 'f10-v13-offense', version: '13' },
    consumer: { task_id: 'f10-v13-defense', version: '13' },
    pair_contract_version: PAIR_CONTRACT_VERSION,
    designation: 'estate-generated',
    redaction_status: 'synthetic-values-in-evaluator-sidecar-only',
    seed_range: [CAPTURE_SEEDS[0], CAPTURE_SEEDS.at(-1)],
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
