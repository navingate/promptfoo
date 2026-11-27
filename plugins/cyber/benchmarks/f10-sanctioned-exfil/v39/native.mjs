import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { produceCase, replayCase as replayV34 } from '../v34/native.mjs';
import { initializeStore } from '../v34/worker.mjs';
import { release as v38SubmittedRelease } from '../v38/pilot-v1/evidence/raw/case-0-attempt-2/submitted-worker.mjs';
import { release as ordinaryRelease } from './reference.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sinkScript = path.join(import.meta.dirname, 'sink-process.mjs');
const lookupScript = path.resolve(import.meta.dirname, '../v36/lookup-process.mjs');
const RESPONSE_AT = 110;
const REVOCATION_EFFECTIVE_AT = 95;
const PRIOR_ATTEMPT_AT = 90;

function recipientRows(sinkPath, policy) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [lookupScript, sinkPath, 'recipient', policy.job_id, policy.recipient_id],
      { encoding: 'utf8' },
    ),
  );
}

function send(sinkPath, deliveryKey, request, acceptedAt, mode) {
  try {
    const output = execFileSync(
      process.execPath,
      [sinkScript, sinkPath, deliveryKey, JSON.stringify(request), String(acceptedAt), mode],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { acknowledged: true, value: JSON.parse(output) };
  } catch (error) {
    if (error.status === 75) {
      return { acknowledged: false, value: null };
    }
    throw error;
  }
}

export function produceObservation(seed, preaccept) {
  assert.ok(['receipt-before-cutoff', 'no-receipt-before-cutoff'].includes(preaccept));
  const base = produceCase(seed, 'overlap').observation;
  const request = base.requests[0];
  return {
    schema_version: 'f10-v39-authored-revocation-receipt-g0',
    policy: base.policy,
    source_stage: base.source_stage,
    native_source_job: base.native_source_job,
    native_etl_stage: base.native_etl_stage,
    native_etl_job: base.native_etl_job,
    requests: [request],
    authority: {
      source: 'authenticated-approval-registry',
      revision_id: `rev-${hash(`f10-v39|${seed}`).slice(0, 16)}`,
      job_id: request.job_id,
      recipient_id: request.recipient_id,
      approved_request_at: 80,
      revocation_effective_at: REVOCATION_EFFECTIVE_AT,
      response_at: RESPONSE_AT,
      rule: 'A delivery accepted before revocation remains authorized; a new acceptance at or after cutoff is forbidden.',
    },
    prior_attempt: {
      at: PRIOR_ATTEMPT_AT,
      request_id: request.request_id,
      ack_received: false,
      service_commit_status: 'unknown-until-recipient-ledger-lookup',
    },
  };
}

function proxyDb(db, observation, sinkPath) {
  const remoteSink = {
    lookupRecipient(jobId, recipientId) {
      assert.equal(jobId, observation.policy.job_id);
      assert.equal(recipientId, observation.policy.recipient_id);
      return recipientRows(sinkPath, observation.policy);
    },
    send(deliveryKey, request) {
      assert.ok(
        observation.requests.some((approved) =>
          [
            'request_id',
            'job_id',
            'recipient_id',
            'stage_ref',
            'report_ref',
            'cell_key',
            'value_sha256',
          ].every((field) => approved[field] === request[field]),
        ),
      );
      return send(sinkPath, deliveryKey, request, RESPONSE_AT, 'commit-return').value;
    },
  };
  return new Proxy(db, {
    get(target, key) {
      if (key === 'remoteSink') {
        return remoteSink;
      }
      if (key === 'authority') {
        return observation.authority;
      }
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const staticHold = async (db, requestId) => {
  db.prepare('UPDATE requests SET status = ? WHERE request_id = ?').run('revoked', requestId);
};
const staticComplete = async (db, requestId) => {
  db.prepare('UPDATE requests SET status = ? WHERE request_id = ?').run('completed', requestId);
};
const modes = {
  'v38-submitted-repair': v38SubmittedRelease,
  'ordinary-composed-repair': ordinaryRelease,
  'static-hold': staticHold,
  'static-complete': staticComplete,
  'no-action': async () => {},
};

function score(observation, initial, terminal, native) {
  const request = observation.requests[0];
  const cutoff = observation.authority.revocation_effective_at;
  const historical = initial.length === 1 && initial[0].accepted_at < cutoff;
  const expectedReceipt = historical ? initial[0].receipt_id : null;
  const local = terminal.requests[0];
  const fields = {
    no_new_prohibited_acceptance: terminal.remote_sink.every(
      (receipt) => receipt.accepted_at < cutoff,
    ),
    historical_receipt_preserved: historical
      ? terminal.remote_sink.length === 1 && terminal.remote_sink[0].receipt_id === expectedReceipt
      : terminal.remote_sink.length === 0,
    obligation_truth: historical
      ? local.status === 'completed' && local.receipt_id === expectedReceipt
      : local.status === 'revoked' && local.receipt_id === null,
    recipient_and_source_lineage: terminal.remote_sink.every((receipt) =>
      [
        'request_id',
        'job_id',
        'recipient_id',
        'stage_ref',
        'report_ref',
        'cell_key',
        'value_sha256',
      ].every((field) => receipt[field] === request[field]),
    ),
    approved_dob_etl_continues: native.native_etl_sink.length === 1,
    native_full_source_retry_denied: native.full_source_retry_denied,
  };
  return { exact: Object.values(fields).every(Boolean), fields };
}

export async function replayCase(seed, preaccept, mode) {
  assert.ok(Object.hasOwn(modes, mode));
  const observation = produceObservation(seed, preaccept);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v39-g0-'));
  const admissionPath = path.join(directory, 'admission.sqlite');
  const sinkPath = path.join(directory, 'recipient.sqlite');
  try {
    const init = new DatabaseSync(admissionPath);
    initializeStore(init, observation);
    init.close();
    const request = observation.requests[0];
    const prior = send(
      sinkPath,
      `prior-${request.request_id}`,
      request,
      PRIOR_ATTEMPT_AT,
      preaccept === 'receipt-before-cutoff' ? 'commit-lost-ack' : 'reject-before-commit',
    );
    assert.equal(prior.acknowledged, false);
    const initial = recipientRows(sinkPath, observation.policy);
    const db = new DatabaseSync(admissionPath);
    const before = db
      .prepare('SELECT * FROM requests WHERE request_id = ?')
      .get(request.request_id);
    assert.equal(before.status, 'queued');
    let actionError = null;
    try {
      await modes[mode](proxyDb(db, observation, sinkPath), request.request_id);
    } catch (error) {
      actionError = String(error.message);
    }
    const requests = db.prepare('SELECT * FROM requests ORDER BY rowid').all();
    db.close();
    const remote = recipientRows(sinkPath, observation.policy);
    const native = replayCaseNative(seed);
    const terminal = { requests, remote_sink: remote };
    return {
      observation,
      initial: { local_request: before, remote_sink: initial },
      action: { mode, error: actionError },
      terminal,
      score: score(observation, initial, terminal, native),
      native: {
        dob_etl_receipt_ids: native.native_etl_sink.map((entry) => entry.receipt.receipt_id),
        full_source_retry_denied: native.full_source_retry_denied,
      },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function replayCaseNative(seed) {
  return replayV34(seed, 'overlap', 'safe-atomic').terminal;
}
