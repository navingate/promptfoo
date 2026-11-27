// F8 v21 authored consumer/sink simulation. Each CLI invocation is a separate process.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import { produceConsumerRestartPair } from '../../offense/scripts/produce-consumer-restart.mjs';

const FIXTURE_SHA256 = '0419744ffba83f216603266fed6ac8d14966df2cedad50ecc285eed55991695e';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function loadFixture(path) {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== FIXTURE_SHA256) {
    throw new Error('authored consumer fixture hash mismatch');
  }
  const fixture = JSON.parse(bytes.toString('utf8'));
  if (!same(fixture, produceConsumerRestartPair())) {
    throw new Error('authored consumer producer conformance mismatch');
  }
  return fixture;
}

function writeState(path, state) {
  const bytes = `${JSON.stringify(state, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
  return sha256(bytes);
}

function receipt(record, attempt, processStage) {
  const core = {
    delivery_id: record.delivery_id,
    target_offset: record.target_offset,
    attempt,
    process_stage: processStage,
    status: 'acknowledged',
  };
  return { ...core, receipt_id: `sink-ack-${sha256(JSON.stringify(core)).slice(0, 12)}` };
}

function sourceAudit(fixture, effects) {
  const preCrashRecords = fixture.target_records.filter((record) => !record.approved_after_restart);
  const [first, last] = preCrashRecords;
  if (
    preCrashRecords.length !== 2 ||
    !effects.some((effect) => effect.delivery_id === first.delivery_id)
  ) {
    throw new Error('source audit requires the first pre-crash delivery acknowledgment');
  }
  const actions = [
    {
      action: 'poll_pre_crash_records',
      target_offsets: preCrashRecords.map((r) => r.target_offset),
    },
    { action: 'sink_ack', delivery_id: first.delivery_id },
    { action: 'broker_commit', committed_next_offset: fixture.source_group.committed_next_offset },
    { action: 'sink_submit', delivery_id: last.delivery_id },
  ];
  if (effects.some((effect) => effect.delivery_id === last.delivery_id)) {
    actions.push({ action: 'sink_ack', delivery_id: last.delivery_id });
  }
  actions.push({ action: 'source_process_exit', exit_code: 73 });
  return actions.map((entry, index) => ({ sequence: index + 1, ...entry }));
}

function sourceRun(fixture, caseId, statePath) {
  const selected = fixture.cases.find((entry) => entry.case_id === caseId);
  if (!selected) {
    throw new Error('unknown authored restart history');
  }
  const preCrashRecords = fixture.target_records.filter((record) => !record.approved_after_restart);
  if (
    selected.pre_crash_acked_delivery_ids.some(
      (id) => !preCrashRecords.some((record) => record.delivery_id === id),
    )
  ) {
    throw new Error('source history acknowledges a post-restart or unknown record');
  }
  const effects = selected.pre_crash_acked_delivery_ids.map((id) => {
    const record = preCrashRecords.find((candidate) => candidate.delivery_id === id);
    return receipt(record, 1, 'source-before-crash');
  });
  const state = {
    schema: 'f8-consumer-restart-state-v1',
    fixture_sha256: FIXTURE_SHA256,
    case_id: caseId,
    stage: 'source-crashed-after-commit',
    source_pid: process.pid,
    source_committed_next_offset: fixture.source_group.committed_next_offset,
    translated_target_next_offset: fixture.target_checkpoint.downstream_next_offset,
    target_broker_committed_next_offset:
      fixture.target_checkpoint.target_broker_committed_next_offset,
    target_log_offsets: preCrashRecords.map((record) => record.target_offset),
    effects,
    source_audit: sourceAudit(fixture, effects),
  };
  const stateHash = writeState(statePath, state);
  process.stdout.write(`${JSON.stringify({ pid: process.pid, state_sha256: stateHash })}\n`);
  process.exitCode = 73;
}

function validatePersisted(fixture, state) {
  const selected = fixture.cases.find((entry) => entry.case_id === state.case_id);
  if (!selected || state.schema !== 'f8-consumer-restart-state-v1') {
    throw new Error('invalid persisted restart state');
  }
  const expectedEffects = selected.pre_crash_acked_delivery_ids.map((id) => {
    const record = fixture.target_records.find((candidate) => candidate.delivery_id === id);
    return receipt(record, 1, 'source-before-crash');
  });
  if (
    state.stage !== 'source-crashed-after-commit' ||
    state.fixture_sha256 !== FIXTURE_SHA256 ||
    state.source_committed_next_offset !== fixture.source_group.committed_next_offset ||
    state.translated_target_next_offset !== fixture.target_checkpoint.downstream_next_offset ||
    state.target_broker_committed_next_offset !==
      fixture.target_checkpoint.target_broker_committed_next_offset ||
    !same(
      state.target_log_offsets,
      fixture.target_records
        .filter((record) => !record.approved_after_restart)
        .map((record) => record.target_offset),
    ) ||
    !Number.isInteger(state.source_pid) ||
    !same(state.effects, expectedEffects) ||
    !same(state.source_audit, sourceAudit(fixture, expectedEffects))
  ) {
    throw new Error('persisted restart state does not match source receipts and checkpoint');
  }
}

function restart(fixture, statePath, cursorChoice, sendMode) {
  const bytes = readFileSync(statePath);
  const reloadedStateSha256 = sha256(bytes);
  const state = JSON.parse(bytes.toString('utf8'));
  validatePersisted(fixture, state);
  if (state.source_pid === process.pid) {
    throw new Error('restart must occur in a different process');
  }
  const effects = structuredClone(state.effects);
  const newRecords = fixture.target_records.filter((record) => record.approved_after_restart);
  const targetLogOffsets = [
    ...state.target_log_offsets,
    ...newRecords.map((record) => record.target_offset),
  ];
  const records = fixture.target_records.filter((record) =>
    targetLogOffsets.includes(record.target_offset),
  );
  const trace = [];
  for (const record of newRecords) {
    trace.push({ action: 'approved_target_record_appended', target_offset: record.target_offset });
  }
  const hasReceipt = (record) =>
    effects.some((effect) => effect.delivery_id === record.delivery_id);
  let cursor;
  switch (cursorChoice) {
    case 'source-offset':
      cursor = state.source_committed_next_offset;
      break;
    case 'translated-checkpoint':
      cursor = state.translated_target_next_offset;
      break;
    case 'target-broker-checkpoint':
      cursor = state.target_broker_committed_next_offset;
      break;
    case 'earliest-retained':
      cursor = records[0].target_offset;
      break;
    default:
      throw new Error('unsupported target cursor choice');
  }
  if (!fixture.service_contract.restart_plan.send_modes.includes(sendMode)) {
    throw new Error('unsupported external send mode');
  }
  if (!Number.isInteger(cursor) || cursor < records[0].target_offset) {
    throw new Error('unsupported target cursor');
  }
  trace.push({ action: 'seek_target', cursor, source: cursorChoice });
  for (const record of records.filter((candidate) => candidate.target_offset >= cursor)) {
    const acknowledged = hasReceipt(record);
    if (sendMode === 'lookup-before-send') {
      trace.push({
        action: 'lookup_external_receipt',
        delivery_id: record.delivery_id,
        acknowledged,
      });
    }
    if (sendMode === 'idempotent-send') {
      trace.push({ action: 'external_idempotent_send', delivery_id: record.delivery_id });
    }
    if (acknowledged && sendMode !== 'raw') {
      trace.push({ action: 'sink_deduplicated_or_skipped', delivery_id: record.delivery_id });
      continue;
    }
    if (!record.approved) {
      throw new Error('unapproved external delivery');
    }
    const attempt =
      effects.filter((effect) => effect.delivery_id === record.delivery_id).length + 1;
    const result = receipt(record, attempt, 'target-after-restart');
    effects.push(result);
    trace.push({ action: 'external_send', ...result });
  }
  const deliveryCounts = Object.fromEntries(
    records.map((record) => [
      record.delivery_id,
      effects.filter((effect) => effect.delivery_id === record.delivery_id).length,
    ]),
  );
  const missing = Object.keys(deliveryCounts).filter((id) => deliveryCounts[id] === 0);
  const duplicate = Object.keys(deliveryCounts).filter((id) => deliveryCounts[id] > 1);
  const metrics = {
    delivery_counts: deliveryCounts,
    missing_delivery_ids: missing,
    duplicate_delivery_ids: duplicate,
    new_approved_delivered: deliveryCounts['delivery-d'] === 1,
    all_approved_exactly_once: missing.length === 0 && duplicate.length === 0,
  };
  const terminalState = {
    ...state,
    stage: 'target-restarted',
    target_pid: process.pid,
    cursor_choice: cursorChoice,
    send_mode: sendMode,
    target_log_offsets: targetLogOffsets,
    effects,
  };
  const terminalStateSha256 = writeState(statePath, terminalState);
  process.stdout.write(
    `${JSON.stringify({
      pid: process.pid,
      source_pid: state.source_pid,
      reloaded_state_sha256: reloadedStateSha256,
      terminal_state_sha256: terminalStateSha256,
      cursor,
      cursor_choice: cursorChoice,
      send_mode: sendMode,
      trace,
      metrics,
      outcome: metrics.all_approved_exactly_once ? 'pass' : 'fail',
    })}\n`,
  );
}

try {
  const [command, fixturePath, ...args] = process.argv.slice(2);
  if (!fixturePath) {
    throw new Error('usage: consumer-restart-worker.mjs prepare|restart fixture state [policy]');
  }
  const fixture = loadFixture(fixturePath);
  if (command === 'prepare' && args.length === 2) {
    sourceRun(fixture, args[0], args[1]);
  } else if (command === 'restart' && args.length === 3) {
    restart(fixture, args[0], args[1], args[2]);
  } else {
    throw new Error('unsupported consumer worker command');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
