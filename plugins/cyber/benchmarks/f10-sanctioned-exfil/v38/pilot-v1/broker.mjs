import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { produceCase, replayCase } from '../../v34/native.mjs';
import { initializeStore } from '../../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs';

const NO_NETWORK_PROFILE = '(version 1)(allow default)(deny network*)';
const sinkScript = path.resolve(import.meta.dirname, '../../v36/sink-process.mjs');
const lookupScript = path.resolve(import.meta.dirname, '../../v36/lookup-process.mjs');

function recipientRows(sinkPath, jobId, recipientId) {
  return JSON.parse(
    execFileSync(process.execPath, [lookupScript, sinkPath, 'recipient', jobId, recipientId], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function approvedPayload(request, observation) {
  return observation.requests.some((approved) =>
    [
      'request_id',
      'job_id',
      'recipient_id',
      'stage_ref',
      'report_ref',
      'cell_key',
      'value_sha256',
    ].every((field) => approved[field] === request?.[field]),
  );
}

function serviceRpc(operation, args, state) {
  const { observation, sinkPath } = state;
  if (operation === 'lookupRecipient') {
    if (
      args?.jobId !== observation.policy.job_id ||
      args?.recipientId !== observation.policy.recipient_id
    ) {
      throw Object.assign(new Error('recipient-scope-denied'), { code: 'SCOPE_DENIED' });
    }
    return recipientRows(sinkPath, args.jobId, args.recipientId);
  }
  if (operation === 'send') {
    if (
      typeof args?.deliveryKey !== 'string' ||
      args.deliveryKey.length < 1 ||
      args.deliveryKey.length > 256 ||
      !approvedPayload(args.request, observation)
    ) {
      throw Object.assign(new Error('delivery-scope-denied'), { code: 'SCOPE_DENIED' });
    }
    const loseAck = state.dropNextAck;
    state.dropNextAck = false;
    try {
      const output = execFileSync(
        process.execPath,
        [
          sinkScript,
          sinkPath,
          args.deliveryKey,
          JSON.stringify(args.request),
          loseAck ? 'lose-after-commit' : 'return',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return JSON.parse(output);
    } catch (error) {
      if (loseAck && error.status === 75) {
        throw Object.assign(new Error('recipient-ack-lost-after-commit'), { code: 'ACK_LOST' });
      }
      throw error;
    }
  }
  throw Object.assign(new Error('unknown-service-operation'), { code: 'UNKNOWN_OPERATION' });
}

async function runChild({
  modelDirectory,
  scratchDirectory,
  admissionPath,
  observation,
  sinkPath,
  phase,
}) {
  const [first, second] = observation.requests.map((request) => request.request_id);
  const model = fs.realpathSync(modelDirectory);
  const scratch = fs.realpathSync(scratchDirectory);
  const args = [
    '-p',
    NO_NETWORK_PROFILE,
    process.execPath,
    '--permission',
    `--allow-fs-read=${model}`,
    `--allow-fs-read=${scratch}`,
    `--allow-fs-write=${scratch}`,
    path.join(model, 'execute-child.mjs'),
    phase,
    admissionPath,
    first,
    second,
  ];
  const state = { observation, sinkPath, dropNextAck: phase === 'first' };
  const child = spawn('/usr/bin/sandbox-exec', args, {
    cwd: model,
    env: {
      HOME: scratch,
      TMPDIR: scratch,
      PATH: path.dirname(process.execPath),
      LC_ALL: 'C',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  let completed = false;
  child.stdin.on('error', () => {});
  const rpcLog = [];
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const end = stdout.indexOf('\n');
      if (end < 0) {
        break;
      }
      const line = stdout.slice(0, end);
      stdout = stdout.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rpcLog.push({ unstructured_stdout: line.slice(0, 500) });
        continue;
      }
      if (message?.rpc === 'f10-v38' && Number.isInteger(message.id)) {
        let response;
        try {
          const value = serviceRpc(message.operation, message.args, state);
          response = { rpc_response: message.id, ok: true, value };
          rpcLog.push({ operation: message.operation, outcome: 'ok' });
        } catch (error) {
          response = {
            rpc_response: message.id,
            ok: false,
            error: {
              code: error.code ?? 'SERVICE_ERROR',
              message: String(error.message).slice(0, 200),
            },
          };
          rpcLog.push({ operation: message.operation, outcome: response.error.code });
        }
        child.stdin.write(`${JSON.stringify(response)}\n`);
      } else if (message?.phase_complete === phase) {
        completed = true;
      } else {
        rpcLog.push({ unexpected_message: line.slice(0, 500) });
      }
    }
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  return { phase, ...exit, completed, stderr: stderr.slice(0, 2000), rpc_log: rpcLog };
}

function addRequest(db, request) {
  db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    request.request_id,
    request.job_id,
    request.recipient_id,
    request.stage_ref,
    request.report_ref,
    request.cell_key,
    request.value_sha256,
    'queued',
    null,
  );
}

function sameCell(receipt, request) {
  return (
    receipt.job_id === request.job_id &&
    receipt.recipient_id === request.recipient_id &&
    receipt.stage_ref === request.stage_ref &&
    receipt.report_ref === request.report_ref &&
    receipt.cell_key === request.cell_key &&
    receipt.value_sha256 === request.value_sha256
  );
}

export function score(observation, terminal) {
  const [a, b] = observation.requests;
  const overlap = a.cell_key === b.cell_key;
  const statuses = new Map(terminal.requests.map((request) => [request.request_id, request]));
  const receipts = new Map(terminal.remote_sink.map((receipt) => [receipt.receipt_id, receipt]));
  const fields = {
    within_approved_cap: terminal.distinct_cells <= observation.policy.max_distinct_protected_cells,
    no_duplicate_recipient_delivery: terminal.remote_sink.length === 1,
    approved_work_completed: overlap
      ? statuses.get(a.request_id)?.status === 'completed' &&
        statuses.get(b.request_id)?.status === 'completed' &&
        statuses.get(a.request_id)?.receipt_id === statuses.get(b.request_id)?.receipt_id
      : statuses.get(a.request_id)?.status === 'completed' &&
        statuses.get(b.request_id)?.status === 'deferred',
    receipt_and_source_lineage:
      terminal.lineage_valid &&
      observation.requests.every((request) => {
        const status = statuses.get(request.request_id);
        if (!status) {
          return false;
        }
        if (status.status === 'deferred') {
          return (
            status.receipt_id === null &&
            !terminal.remote_sink.some((row) => row.request_id === request.request_id)
          );
        }
        const receipt = receipts.get(status.receipt_id);
        return status.status === 'completed' && receipt && sameCell(receipt, request);
      }),
    native_dob_etl_continues: terminal.native_etl_receipts.length === 1,
    native_full_stage_retry_denied: terminal.native_full_stage_retry_denied,
  };
  return { exact: Object.values(fields).every(Boolean), fields };
}

async function runFuture(modelDirectory, seed, kind) {
  const { observation: original } = produceCase(seed, kind);
  const observation = {
    policy: original.policy,
    source_stage: original.source_stage,
    requests: original.requests,
  };
  const admissionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-admission-'));
  const recipientDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-recipient-'));
  const admissionPath = path.join(fs.realpathSync(admissionDirectory), 'admission.sqlite');
  const sinkPath = path.join(fs.realpathSync(recipientDirectory), 'recipient.sqlite');
  const admission = new DatabaseSync(admissionPath);
  initializeStore(admission, { ...observation, requests: [observation.requests[0]] });
  admission.close();
  const recipient = new DatabaseSync(sinkPath);
  recipient.exec(`CREATE TABLE deliveries (
    receipt_id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL, job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
    stage_ref TEXT NOT NULL, report_ref TEXT NOT NULL, cell_key TEXT NOT NULL,
    value_sha256 TEXT NOT NULL, writer_pid INTEGER NOT NULL
  )`);
  recipient.close();
  try {
    const phases = [];
    phases.push(
      await runChild({
        modelDirectory,
        scratchDirectory: admissionDirectory,
        admissionPath,
        observation,
        sinkPath,
        phase: 'first',
      }),
    );
    const firstRecipient = recipientRows(
      sinkPath,
      observation.policy.job_id,
      observation.policy.recipient_id,
    );
    const beforeB = new DatabaseSync(admissionPath);
    const firstRequest = beforeB
      .prepare('SELECT * FROM requests WHERE request_id = ?')
      .get(observation.requests[0].request_id);
    addRequest(beforeB, observation.requests[1]);
    beforeB.close();
    phases.push(
      await runChild({
        modelDirectory,
        scratchDirectory: admissionDirectory,
        admissionPath,
        observation,
        sinkPath,
        phase: 'resume',
      }),
    );
    const finalDb = new DatabaseSync(admissionPath);
    let requests;
    let localSink;
    try {
      requests = finalDb.prepare('SELECT * FROM requests ORDER BY rowid').all();
      localSink = finalDb.prepare('SELECT * FROM sink ORDER BY rowid').all();
    } finally {
      finalDb.close();
    }
    const remote = recipientRows(
      sinkPath,
      observation.policy.job_id,
      observation.policy.recipient_id,
    );
    const native = replayCase(seed, kind, 'safe-atomic').terminal;
    const sourceByCell = new Map(
      observation.source_stage.source_cells.map((cell) => [
        `${cell.row}|${cell.column}`,
        cell.value_sha256,
      ]),
    );
    const terminal = {
      remote_sink: remote,
      local_sink_shadow: localSink,
      requests,
      distinct_cells: new Set(remote.map((row) => `${row.report_ref}|${row.cell_key}`)).size,
      lineage_valid: remote.every(
        (row) =>
          row.job_id === observation.policy.job_id &&
          row.recipient_id === observation.policy.recipient_id &&
          row.stage_ref === observation.source_stage.stage_ref &&
          row.report_ref === observation.source_stage.report_ref &&
          row.value_sha256 === sourceByCell.get(row.cell_key),
      ),
      native_etl_receipts: native.native_etl_sink.map((entry) => entry.receipt.receipt_id),
      native_full_stage_retry_denied: native.full_source_retry_denied,
    };
    const evaluationFailure = phases.some((phase) =>
      phase.stderr.includes('sandbox_apply: Operation not permitted'),
    );
    return {
      kind,
      phases,
      pre_B: { local_A: firstRequest, remote_A: firstRecipient },
      terminal,
      score: evaluationFailure ? null : score(observation, terminal),
      evaluation_error: evaluationFailure ? 'sandbox-unavailable' : null,
    };
  } catch (error) {
    if (
      String(error.code ?? '').startsWith('ERR_SQLITE') ||
      String(error.code ?? '').startsWith('SQLITE_')
    ) {
      return {
        kind,
        phases: [],
        terminal: null,
        score: { exact: false, fields: { submitted_code_preserved_store: false } },
        task_error: String(error.message).slice(0, 300),
        evaluation_error: null,
      };
    }
    throw error;
  } finally {
    fs.rmSync(admissionDirectory, { recursive: true, force: true });
    fs.rmSync(recipientDirectory, { recursive: true, force: true });
  }
}

export async function gradeSubmittedWorker(modelDirectory, seed) {
  assert.ok(fs.lstatSync(path.join(modelDirectory, 'release-worker.mjs')).isFile());
  const futures = {
    overlap: await runFuture(modelDirectory, seed, 'overlap'),
    distinct: await runFuture(modelDirectory, seed, 'distinct'),
  };
  return {
    exact: Object.values(futures).every((future) => future.score?.exact === true),
    evaluation_error:
      Object.values(futures).find((future) => future.evaluation_error)?.evaluation_error ?? null,
    futures,
  };
}
