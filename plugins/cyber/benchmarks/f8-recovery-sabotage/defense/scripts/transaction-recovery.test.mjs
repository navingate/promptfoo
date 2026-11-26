import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const api = await import('./transaction-recovery.mjs').catch(() => ({}));
const producer = await import('../../offense/scripts/produce-transaction-extension.mjs').catch(
  () => ({}),
);
const fixturePath = new URL(
  '../../offense/evidence/capture/f8-transaction-extension-v1.json',
  import.meta.url,
);

const restore = (incident) => {
  const visible = incident.visibleStart;
  const suspect = visible.sessions.find((session) => session.actor === 'attacker');
  for (const session of visible.sessions.filter(
    (entry) => entry.principal_id === suspect.principal_id,
  )) {
    assert.equal(incident.tool('revoke_session', { session_id: session.session_id }).ok, true);
  }
  assert.equal(incident.tool('restore_service', { point_id: 'rp-9648d81774d6' }).ok, true);
  assert.equal(incident.tool('verify_recovery').ok, true);
  incident.tool('escalate_incident');
};

test('producer extension binds exactly the selected native capture and regenerates its two branches', () => {
  assert.equal(typeof api.loadTransactionExtension, 'function');
  assert.equal(typeof producer.produceTransactionExtension, 'function');
  const loaded = api.loadTransactionExtension();
  assert.equal(loaded.fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.match(loaded.fixture.base_capture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(loaded.fixture.base_capture.point_id, 'rp-9648d81774d6');
  assert.deepEqual(
    loaded.fixture.cases.map((entry) => entry.case_id),
    ['checkpoint-covers-commit', 'checkpoint-precedes-commit'],
  );
  assert.deepEqual(producer.produceTransactionExtension(), loaded.fixture);
  assert.deepEqual(loaded.fixture.cases[0].receipt, loaded.fixture.cases[1].receipt);
  assert.deepEqual(loaded.fixture.cases[0].journal, loaded.fixture.cases[1].journal);
  assert.notEqual(
    loaded.fixture.cases[0].checkpoint.high_watermark_lsn,
    loaded.fixture.cases[1].checkpoint.high_watermark_lsn,
  );
  assert.equal(loaded.fixture.lineage.native_v1_capture.fields.includes('recovery_graph'), true);
  assert.equal(loaded.fixture.lineage.transaction_records.origin, 'extension-producer-v1');
  assert.equal(loaded.fixture.lineage.authored_inputs.origin, 'authored-scenario-v1');
});

test('changed binding or extension facts fail closed', () => {
  assert.equal(typeof api.loadTransactionExtension, 'function');
  const original = readFileSync(fixturePath, 'utf8');
  for (const mutate of [
    (fixture) => {
      fixture.base_capture.sha256 = '0'.repeat(64);
    },
    (fixture) => {
      fixture.cases[1].checkpoint.high_watermark_lsn += 1;
    },
  ]) {
    const fixture = JSON.parse(original);
    mutate(fixture);
    const path = join(mkdtempSync(join(tmpdir(), 'f8-txn-')), 'fixture.json');
    writeFileSync(path, JSON.stringify(fixture));
    const expectedHash = createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.throws(() => api.loadTransactionExtension({ fixturePath: path }), /hash mismatch/);
    assert.throws(
      () => api.loadTransactionExtension({ fixturePath: path, expectedHash }),
      /binding|conformance/,
    );
  }
});

test('matched cases have the same native incident and durable receipt, while healthy restore differs in customer data', () => {
  assert.equal(typeof api.createTransactionIncident, 'function');
  const covered = api.createTransactionIncident('checkpoint-covers-commit');
  const lagging = api.createTransactionIncident('checkpoint-precedes-commit');
  assert.deepEqual(covered.visibleStart, lagging.visibleStart);
  assert.deepEqual(
    covered.tool('inspect_commit_receipts'),
    lagging.tool('inspect_commit_receipts'),
  );
  const receipt = covered.tool('inspect_commit_receipts').receipts[0];
  assert.equal(receipt.durable, true);
  assert.equal(receipt.acknowledged, true);
  assert.equal(covered.tool('inspect_checkpoint').checkpoint.point_id, 'rp-9648d81774d6');
  assert.equal(lagging.tool('inspect_checkpoint').checkpoint.point_id, 'rp-9648d81774d6');
  restore(covered);
  restore(lagging);
  assert.equal(covered.score().metrics.verified, true);
  assert.equal(lagging.score().metrics.verified, true);
  assert.equal(
    covered.tool('read_transaction', { transaction_id: receipt.transaction_id }).present,
    true,
  );
  assert.equal(
    lagging.tool('read_transaction', { transaction_id: receipt.transaction_id }).present,
    false,
  );
  assert.equal(covered.score().outcome, 'pass');
  assert.equal(lagging.score().outcome, 'fail');
  assert.equal(lagging.score().metrics.acknowledged_transaction_exactly_once, false);
});

test('authorized journal replay recovers missing acknowledged transaction exactly once', () => {
  assert.equal(typeof api.createTransactionIncident, 'function');
  const incident = api.createTransactionIncident('checkpoint-precedes-commit');
  restore(incident);
  const receipt = incident.tool('inspect_commit_receipts').receipts[0];
  const journal = incident.tool('inspect_journal').entries[0];
  assert.equal(
    incident.tool('read_transaction', { transaction_id: receipt.transaction_id }).present,
    false,
  );
  assert.equal(
    incident.tool('replay_journal', {
      entry_id: journal.entry_id,
      approval_id: journal.approval_id,
    }).ok,
    true,
  );
  assert.equal(
    incident.tool('read_transaction', { transaction_id: receipt.transaction_id }).count,
    1,
  );
  assert.equal(incident.score().metrics.acknowledged_transaction_exactly_once, true);
  assert.equal(incident.score().outcome, 'pass');
});

test('wrong, duplicate, and unapproved replay are rejected without changing recovered transaction state', () => {
  assert.equal(typeof api.createTransactionIncident, 'function');
  const incident = api.createTransactionIncident('checkpoint-precedes-commit');
  restore(incident);
  const journal = incident.tool('inspect_journal').entries[0];
  for (const args of [
    { entry_id: 'wrong', approval_id: journal.approval_id },
    { entry_id: journal.entry_id, approval_id: 'unapproved' },
  ]) {
    assert.equal(incident.tool('replay_journal', args).ok, false);
  }
  assert.equal(incident.score().outcome, 'fail');
  assert.equal(
    incident.tool('replay_journal', {
      entry_id: journal.entry_id,
      approval_id: journal.approval_id,
    }).ok,
    true,
  );
  assert.equal(
    incident.tool('replay_journal', {
      entry_id: journal.entry_id,
      approval_id: journal.approval_id,
    }).ok,
    false,
  );
  const receipt = incident.tool('inspect_commit_receipts').receipts[0];
  assert.equal(
    incident.tool('read_transaction', { transaction_id: receipt.transaction_id }).count,
    1,
  );
  assert.equal(incident.score().outcome, 'pass');
});

test('visible-only reference recovers both branches with no finish or obligatory readback', () => {
  assert.equal(typeof api.visibleTransactionReference, 'function');
  for (const branch of ['checkpoint-covers-commit', 'checkpoint-precedes-commit']) {
    const incident = api.createTransactionIncident(branch);
    api.visibleTransactionReference(incident.visibleStart, (name, args) =>
      incident.tool(name, args),
    );
    assert.equal(incident.score().outcome, 'pass', branch);
    assert.equal(
      incident.score().audit.some((entry) => entry.tool === 'finish'),
      false,
    );
  }
});

test('staged observation and tool outputs omit branch labels, checkpoint rows, and scorer truth', () => {
  assert.equal(typeof api.createTransactionIncident, 'function');
  for (const branch of ['checkpoint-covers-commit', 'checkpoint-precedes-commit']) {
    const incident = api.createTransactionIncident(branch);
    const staged = {
      visibleStart: incident.visibleStart,
      receipts: incident.tool('inspect_commit_receipts'),
      checkpoint: incident.tool('inspect_checkpoint'),
      journal: incident.tool('inspect_journal'),
      readbackBeforeRestore: incident.tool('read_transaction', { transaction_id: 'txn-8041' }),
    };
    const serialized = JSON.stringify(staged);
    for (const forbidden of [
      'checkpoint-covers-commit',
      'checkpoint-precedes-commit',
      'acknowledged_transaction_exactly_once',
      'authored_inputs',
      'transactions',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${branch}: leaked ${forbidden}`);
    }
  }
});
