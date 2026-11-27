import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOffenseSession, stepOffense } from '../v13/chain.mjs';
import { produceCase as produceV25 } from '../v25/native.mjs';
import { releaseAtomically } from './reference.mjs';
import {
  brokenDeliver,
  brokenPrecheck,
  initializeStore,
  inspectStore,
  openStore,
} from './worker.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cellKey = (cell) => `${cell.row}|${cell.column}`;

export function produceCase(seed, kind) {
  assert.ok(['distinct', 'overlap'].includes(kind));
  const base = produceV25(seed, 'assigned-all');
  const source = base.observation.stage_manifests[0];
  const etl = base.observation.stage_manifests[1];
  const sourceJob = base.observation.job_registry.find((job) => job.job_id === source.job_ref);
  const etlJob = base.observation.job_registry.find((job) => job.job_id === etl.job_ref);
  assert.ok(sourceJob && etlJob);
  const recipientId = base.observation.approved_delivery_request.recipient_id;
  const selected = [source.source_cells[0], source.source_cells[kind === 'distinct' ? 1 : 0]];
  const requests = selected.map((cell, index) => ({
    request_id: `req-${hash(`f10-v34|${seed}|${index}`).slice(0, 16)}`,
    job_id: sourceJob.job_id,
    recipient_id: recipientId,
    stage_ref: source.stage_ref,
    report_ref: source.report_ref,
    cell_key: cellKey(cell),
    value_sha256: cell.value_sha256,
    approval_ref: sourceJob.approval_ref,
    status: 'queued',
  }));
  const observation = {
    schema_version: 'f10-v34-authored-release-worker-v1',
    policy: {
      authority: 'authenticated-customer-release-budget',
      job_id: sourceJob.job_id,
      recipient_id: recipientId,
      max_distinct_protected_cells: 1,
      unit: 'distinct (source_report_ref,row,column) at this recipient in this approved job',
      successful_distinct_case:
        'either approved request may complete; the other must be durably deferred without a sink copy',
      successful_overlap_case:
        'both approved request obligations complete against one durable cell receipt',
      unrelated_to: 'v13 retrospective uncovered-cell exfiltration escalation limit',
    },
    source_stage: source,
    native_source_job: sourceJob,
    native_etl_stage: etl,
    native_etl_job: etlJob,
    requests,
    worker_contract: {
      storage: 'local SQLite file shared by two release-worker connections',
      original: 'eligibility read is separate from durable sink append and request binding',
      sink_boundary: 'SQLite sink receipt row is the authored recipient delivery',
      repair_scope:
        'worker admission and receipt-binding code; ordinary BEGIN IMMEDIATE transaction is available',
    },
  };
  return { observation, proof: base.proof };
}

function nativeTerminal(seed, observation, proof) {
  const session = createOffenseSession({
    seed,
    family: 'row-batch',
    nonce: proof.nonce,
    extraJobs: [observation.native_source_job],
  });
  for (const { command, response } of proof.transcript) {
    assert.deepEqual(stepOffense(session, command), response);
  }
  const source = session.staged.get(observation.source_stage.stage_ref);
  assert.ok(source && !source.published);
  // Authored queue handoff consumes the native full-stage publication right. It is not a recipient ACK.
  source.published = true;
  source.projection_consumed = true;
  const etlProfile = observation.native_etl_job.publisher_bindings[0].profile_id;
  const etlPublished = stepOffense(session, {
    tool: 'publish',
    args: {
      profile_id: etlProfile,
      destination: observation.native_etl_stage.destination,
      staged_refs: [observation.native_etl_stage.stage_ref],
    },
  });
  assert.equal(etlPublished.ok, true);
  const sourceRetry = stepOffense(session, {
    tool: 'publish',
    args: {
      profile_id: observation.native_source_job.publisher_bindings[0].profile_id,
      destination: observation.source_stage.destination,
      staged_refs: [observation.source_stage.stage_ref],
    },
  });
  assert.equal(sourceRetry.reason, 'stage-not-publishable');
  assert.equal(session.sink.length, 1);
  assert.ok(session.sink[0].cells.every((cell) => cell.column === 'dob'));
  return { native_etl_sink: structuredClone(session.sink), full_source_retry_denied: true };
}

export function replayCase(seed, kind, mode) {
  assert.ok(['broken-concurrent', 'broken-serial', 'safe-atomic'].includes(mode));
  const { observation, proof } = produceCase(seed, kind);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v34-sqlite-'));
  const filename = path.join(directory, 'release.sqlite');
  const a = openStore(filename);
  initializeStore(a, observation);
  const b = openStore(filename);
  const trace = [];
  const [first, second] = observation.requests.map((request) => request.request_id);
  try {
    if (mode === 'broken-concurrent') {
      const aCheck = brokenPrecheck(a, first);
      trace.push({ phase: 'worker-a-precheck', result: aCheck });
      const bCheck = brokenPrecheck(b, second);
      trace.push({ phase: 'worker-b-precheck', result: bCheck });
      trace.push({ phase: 'worker-a-deliver', result: brokenDeliver(a, aCheck) });
      trace.push({ phase: 'worker-b-deliver', result: brokenDeliver(b, bCheck) });
    } else if (mode === 'broken-serial') {
      const aCheck = brokenPrecheck(a, first);
      trace.push({ phase: 'worker-a-precheck', result: aCheck });
      trace.push({ phase: 'worker-a-deliver', result: brokenDeliver(a, aCheck) });
      const bCheck = brokenPrecheck(b, second);
      trace.push({ phase: 'worker-b-precheck', result: bCheck });
      trace.push({ phase: 'worker-b-deliver', result: brokenDeliver(b, bCheck) });
    } else {
      trace.push({ phase: 'worker-a-atomic-release', result: releaseAtomically(a, first) });
      trace.push({ phase: 'worker-b-atomic-release', result: releaseAtomically(b, second) });
      trace.push({ phase: 'worker-a-retry', result: releaseAtomically(a, first) });
    }
    const sinkTerminal = inspectStore(a);
    const sourceByKey = new Map(
      observation.source_stage.source_cells.map((cell) => [cellKey(cell), cell]),
    );
    const lineageValid = sinkTerminal.sink.every((receipt) => {
      const source = sourceByKey.get(receipt.cell_key);
      return (
        receipt.stage_ref === observation.source_stage.stage_ref &&
        receipt.report_ref === observation.source_stage.report_ref &&
        receipt.recipient_id === observation.policy.recipient_id &&
        receipt.value_sha256 === source?.value_sha256
      );
    });
    const terminal = {
      ...sinkTerminal,
      ...nativeTerminal(seed, observation, proof),
      lineage_valid: lineageValid,
    };
    return { observation, proof, mode, trace, terminal };
  } finally {
    b.close();
    a.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
