// F8 v21 model-free screen; each source and target stage runs in a new Node process.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = new URL(
  '../../offense/evidence/capture/f8-consumer-restart-v1.json',
  import.meta.url,
);
const WORKER = new URL('./consumer-restart-worker.mjs', import.meta.url);
const OUTPUT = new URL('../calibration/f8-v21-consumer-restart-screen.json', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const CASE_ORDER = ['v21-last-acked', 'v21-last-unacked'];

const POLICIES = {
  'bare-source-offset': ['source-offset', 'raw'],
  'translated-checkpoint': ['translated-checkpoint', 'raw'],
  'target-broker-checkpoint': ['target-broker-checkpoint', 'raw'],
  'raw-rescan': ['earliest-retained', 'raw'],
  'visible-receipt-reference': ['earliest-retained', 'lookup-before-send'],
  'ordinary-idempotent-rescan': ['earliest-retained', 'idempotent-send'],
  'source-offset-with-lookup': ['source-offset', 'lookup-before-send'],
};

function worker(...args) {
  return spawnSync(process.execPath, [fileURLToPath(WORKER), ...args], {
    encoding: 'utf8',
  });
}

function runCase(fixture, caseId, cursorChoice, sendMode) {
  const directory = mkdtempSync(join(tmpdir(), 'f8-v21-screen-'));
  try {
    const statePath = join(directory, 'consumer-state.json');
    const source = worker('prepare', fileURLToPath(FIXTURE), caseId, statePath);
    if (source.status !== 73 || source.stderr) {
      throw new Error(`source stage failed: ${source.stderr || source.status}`);
    }
    const sourceReceipt = JSON.parse(source.stdout);
    const initialBytes = readFileSync(statePath);
    const initialState = JSON.parse(initialBytes.toString('utf8'));
    const target = worker('restart', fileURLToPath(FIXTURE), statePath, cursorChoice, sendMode);
    if (target.status !== 0 || target.stderr) {
      throw new Error(`target stage failed: ${target.stderr || target.status}`);
    }
    const result = JSON.parse(target.stdout);
    const terminalBytes = readFileSync(statePath);
    const terminalState = JSON.parse(terminalBytes.toString('utf8'));
    const boundary = {
      source_pid: sourceReceipt.pid,
      target_pid: result.pid,
      distinct_pids: sourceReceipt.pid !== result.pid,
      prepare_exit_code: source.status,
      restart_exit_code: target.status,
      persisted_state_sha256: sha256(initialBytes),
      reloaded_state_sha256: result.reloaded_state_sha256,
      reloaded_exact_state: sha256(initialBytes) === result.reloaded_state_sha256,
      terminal_state_sha256: sha256(terminalBytes),
    };
    if (
      !boundary.distinct_pids ||
      !boundary.reloaded_exact_state ||
      sourceReceipt.state_sha256 !== boundary.persisted_state_sha256 ||
      result.terminal_state_sha256 !== boundary.terminal_state_sha256
    ) {
      throw new Error('durable process boundary or state hash mismatch');
    }
    return {
      case_id: caseId,
      cursor_choice: cursorChoice,
      send_mode: sendMode,
      visible_start: {
        base_capture: fixture.base_capture,
        source_group: fixture.source_group,
        target_checkpoint: fixture.target_checkpoint,
        target_records: fixture.target_records,
        service_contract: fixture.service_contract,
        external_receipts: initialState.effects,
        source_audit: initialState.source_audit,
      },
      initial_target_log_offsets: initialState.target_log_offsets,
      final_target_log_offsets: terminalState.target_log_offsets,
      terminal_external_effects: terminalState.effects,
      process_boundary: boundary,
      trace: result.trace,
      metrics: result.metrics,
      outcome: result.outcome,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runConsumerRestartScreen() {
  const fixtureBytes = readFileSync(FIXTURE);
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  return {
    contract_id: 'f8-consumer-restart-screen-v21-g0',
    fixture_sha256: sha256(fixtureBytes),
    case_order: CASE_ORDER,
    policies: Object.fromEntries(
      Object.entries(POLICIES).map(([name, [cursorChoice, sendMode]]) => [
        name,
        CASE_ORDER.map((caseId) => runCase(fixture, caseId, cursorChoice, sendMode)),
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node consumer-restart-screen.mjs --write');
  }
  writeFileSync(OUTPUT, `${JSON.stringify(runConsumerRestartScreen(), null, 2)}\n`);
}
