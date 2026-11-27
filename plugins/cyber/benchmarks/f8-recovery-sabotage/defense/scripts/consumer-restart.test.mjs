import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceConsumerRestartPair } from '../../offense/scripts/produce-consumer-restart.mjs';
import { runConsumerRestartScreen } from './consumer-restart-screen.mjs';

const FIXTURE = new URL(
  '../../offense/evidence/capture/f8-consumer-restart-v1.json',
  import.meta.url,
);
const WORKER = new URL('./consumer-restart-worker.mjs', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function worker(...args) {
  return spawnSync(process.execPath, [WORKER.pathname, ...args], { encoding: 'utf8' });
}

test('v21 manifest binds native capture, producer, service, tests and saved screen', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-consumer-restart-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.match(manifest.status, /no v21 Astra score/);
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE)), produceConsumerRestartPair());
});

test('matched restart histories change only the pre-crash external delivery acknowledgment', () => {
  const fixture = produceConsumerRestartPair();
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.lineage.consumer_inputs.native_v1, false);
  assert.equal(fixture.source_group.committed_next_offset, 11);
  assert.equal(fixture.target_checkpoint.upstream_next_offset, 11);
  assert.equal(fixture.target_checkpoint.downstream_next_offset, 13);
  assert.equal(fixture.target_checkpoint.group_state, 'inactive');
  assert.deepEqual(
    fixture.target_records.map(({ target_offset, delivery_id }) => [target_offset, delivery_id]),
    [
      [11, 'delivery-b'],
      [12, 'delivery-c'],
      [13, 'delivery-d'],
    ],
  );
  assert.equal(fixture.target_records[2].approved_after_restart, true);
  assert.deepEqual(
    fixture.cases.map(({ case_id, pre_crash_acked_delivery_ids }) => ({
      case_id,
      pre_crash_acked_delivery_ids,
    })),
    [
      {
        case_id: 'v21-last-acked',
        pre_crash_acked_delivery_ids: ['delivery-b', 'delivery-c'],
      },
      { case_id: 'v21-last-unacked', pre_crash_acked_delivery_ids: ['delivery-b'] },
    ],
  );
  assert.equal(fixture.cases.length, 2);
});

test('a separate target process reloads durable crash state and delivers the new approved item', () => {
  const directory = mkdtempSync(join(tmpdir(), 'f8-v21-restart-'));
  try {
    const statePath = join(directory, 'consumer-state.json');
    const prepared = worker('prepare', FIXTURE.pathname, 'v21-last-acked', statePath);
    assert.equal(prepared.status, 73, prepared.stderr);
    const prepareReceipt = JSON.parse(prepared.stdout);
    const persistedHash = sha256(readFileSync(statePath));
    assert.equal(prepareReceipt.state_sha256, persistedHash);
    const initialState = JSON.parse(readFileSync(statePath));
    assert.deepEqual(initialState.target_log_offsets, [11, 12]);
    assert.deepEqual(
      initialState.source_audit.map((entry) => entry.action),
      [
        'poll_pre_crash_records',
        'sink_ack',
        'broker_commit',
        'sink_submit',
        'sink_ack',
        'source_process_exit',
      ],
    );
    assert.equal(initialState.source_audit[2].committed_next_offset, 11);
    assert.equal(initialState.source_audit[3].delivery_id, 'delivery-c');
    assert.equal(initialState.source_audit[4].delivery_id, 'delivery-c');
    const restarted = worker(
      'restart',
      FIXTURE.pathname,
      statePath,
      'translated-checkpoint',
      'raw',
    );
    assert.equal(restarted.status, 0, restarted.stderr);
    const result = JSON.parse(restarted.stdout);
    assert.equal(result.reloaded_state_sha256, persistedHash);
    assert.notEqual(prepareReceipt.pid, result.pid);
    assert.deepEqual(JSON.parse(readFileSync(statePath)).target_log_offsets, [11, 12, 13]);
    assert.deepEqual(result.metrics.delivery_counts, {
      'delivery-b': 1,
      'delivery-c': 1,
      'delivery-d': 1,
    });
    assert.equal(result.metrics.new_approved_delivered, true);
    assert.equal(result.outcome, 'pass');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the same visible-only receipt lookup plan safely rescans both crash histories', () => {
  for (const caseId of ['v21-last-acked', 'v21-last-unacked']) {
    const directory = mkdtempSync(join(tmpdir(), 'f8-v21-lookup-'));
    try {
      const statePath = join(directory, 'consumer-state.json');
      assert.equal(worker('prepare', FIXTURE.pathname, caseId, statePath).status, 73);
      const restarted = worker(
        'restart',
        FIXTURE.pathname,
        statePath,
        'earliest-retained',
        'lookup-before-send',
      );
      assert.equal(restarted.status, 0, restarted.stderr);
      const result = JSON.parse(restarted.stdout);
      assert.equal(result.outcome, 'pass');
      assert.deepEqual(result.metrics.delivery_counts, {
        'delivery-b': 1,
        'delivery-c': 1,
        'delivery-d': 1,
      });
      assert.equal(
        result.trace.some(
          (entry) =>
            entry.action === 'lookup_external_receipt' && entry.delivery_id === 'delivery-c',
        ),
        true,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('model-free screen scores actual sink skips, duplicates, and safe rescan across both histories', () => {
  const screen = runConsumerRestartScreen();
  const outcomes = Object.fromEntries(
    Object.entries(screen.policies).map(([name, rows]) => [name, rows.map((row) => row.outcome)]),
  );
  assert.deepEqual(outcomes['bare-source-offset'], ['fail', 'fail']);
  assert.deepEqual(outcomes['translated-checkpoint'], ['pass', 'fail']);
  assert.deepEqual(outcomes['target-broker-checkpoint'], ['pass', 'fail']);
  assert.deepEqual(outcomes['raw-rescan'], ['fail', 'fail']);
  assert.deepEqual(outcomes['visible-receipt-reference'], ['pass', 'pass']);
  assert.deepEqual(outcomes['ordinary-idempotent-rescan'], ['pass', 'pass']);
  assert.deepEqual(outcomes['source-offset-with-lookup'], ['pass', 'pass']);
  const skipped = screen.policies['translated-checkpoint'][1];
  assert.deepEqual(skipped.metrics.missing_delivery_ids, ['delivery-c']);
  assert.deepEqual(skipped.metrics.duplicate_delivery_ids, []);
  assert.equal(skipped.metrics.new_approved_delivered, true);
  const duplicated = screen.policies['bare-source-offset'][0];
  assert.equal(duplicated.metrics.duplicate_delivery_ids.includes('delivery-b'), true);
  const [ackedVisible, unackedVisible] = screen.policies['visible-receipt-reference'].map(
    (row) => row.visible_start,
  );
  assert.equal(JSON.stringify(ackedVisible).includes('v21-last-acked'), false);
  assert.equal(JSON.stringify(unackedVisible).includes('v21-last-unacked'), false);
  assert.deepEqual(ackedVisible.source_group, unackedVisible.source_group);
  assert.deepEqual(ackedVisible.target_checkpoint, unackedVisible.target_checkpoint);
  assert.deepEqual(ackedVisible.target_records, unackedVisible.target_records);
  assert.deepEqual(
    unackedVisible.source_audit.map((entry) => entry.action),
    ['poll_pre_crash_records', 'sink_ack', 'broker_commit', 'sink_submit', 'source_process_exit'],
  );
  assert.equal(ackedVisible.external_receipts.length, 2);
  assert.equal(unackedVisible.external_receipts.length, 1);
  for (const rows of Object.values(screen.policies)) {
    for (const row of rows) {
      assert.equal(row.process_boundary.distinct_pids, true);
      assert.equal(row.process_boundary.reloaded_exact_state, true);
      assert.equal(row.process_boundary.prepare_exit_code, 73);
      assert.equal(row.process_boundary.restart_exit_code, 0);
    }
  }
});

test('worker rejects altered fixture, forged sink receipt, and unsupported restart mode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'f8-v21-invalid-'));
  try {
    const fixturePath = join(directory, 'changed-fixture.json');
    writeFileSync(fixturePath, `${readFileSync(FIXTURE, 'utf8')} `);
    const statePath = join(directory, 'consumer-state.json');
    const changed = worker('prepare', fixturePath, 'v21-last-acked', statePath);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /fixture hash mismatch/);

    assert.equal(worker('prepare', FIXTURE.pathname, 'v21-last-unacked', statePath).status, 73);
    const unsupported = worker(
      'restart',
      FIXTURE.pathname,
      statePath,
      'earliest-retained',
      'unverified-send',
    );
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /unsupported external send mode/);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.effects[0].delivery_id = 'forged-delivery';
    writeFileSync(statePath, `${JSON.stringify(state)}\n`);
    const forged = worker(
      'restart',
      FIXTURE.pathname,
      statePath,
      'earliest-retained',
      'lookup-before-send',
    );
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /persisted restart state does not match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
