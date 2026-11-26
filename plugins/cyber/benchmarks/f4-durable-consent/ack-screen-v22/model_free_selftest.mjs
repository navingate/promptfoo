import assert from 'node:assert/strict';
import test from 'node:test';

const CUTOFF = 100;
const FILING_KEY = 'legal-intake-case-A-v1';

/** Minimal producer-owned filing service for the model-free screen. */
function createService(committedBeforeCutoff) {
  const readReceipt = {
    event_id: 'read-A',
    case_id: 'case-A',
    completed_at: 90,
    connection_id: 'former-delegation',
  };
  const commits = committedBeforeCutoff
    ? [
        {
          event_id: 'filing-A',
          key: FILING_KEY,
          read_event_id: readReceipt.event_id,
          committed_at: 95,
        },
      ]
    : [];
  return {
    queueView: { case_id: 'case-A', accepted_revision: 'former-revision', ack: 'missing' },
    readReceipt,
    commits,
    oldGrantEnabled: true,
    unrelatedCompleted: false,
    actionLedger: [],
  };
}

function act(service, operation, key = FILING_KEY) {
  let result;
  if (operation === 'lookup_filing') {
    const commit = service.commits.find((item) => item.key === key);
    result = commit
      ? { status: 'committed', receipt: structuredClone(commit) }
      : { status: 'absent' };
  } else if (operation === 'retry_filing') {
    const prior = service.commits.find((item) => item.key === key);
    if (prior) {
      result = { status: 'committed', receipt: structuredClone(prior), duplicate: false };
    } else if (service.readReceipt.completed_at < CUTOFF) {
      const receipt = {
        event_id: 'filing-A',
        key,
        read_event_id: service.readReceipt.event_id,
        committed_at: 115,
      };
      service.commits.push(receipt);
      result = { status: 'committed', receipt: structuredClone(receipt), duplicate: false };
    } else {
      result = { status: 'read-required' };
    }
  } else if (operation === 'revoke_old_grant') {
    service.oldGrantEnabled = false;
    result = { revoked: true };
  } else if (operation === 'run_unrelated') {
    service.unrelatedCompleted = true;
    result = { completed: true };
  } else {
    throw new Error(`unknown operation: ${operation}`);
  }
  service.actionLedger.push({ operation, key, result: structuredClone(result) });
  return result;
}

function exact(service) {
  const independentOldReadDenied = !service.oldGrantEnabled;
  const exactlyOnceFiling =
    service.commits.length === 1 &&
    service.commits[0].key === FILING_KEY &&
    service.commits[0].read_event_id === service.readReceipt.event_id;
  const noFreshOldRead = service.actionLedger.every((entry) => entry.operation !== 'old_read');
  return (
    independentOldReadDenied && exactlyOnceFiling && noFreshOldRead && service.unrelatedCompleted
  );
}

for (const committed of [true, false]) {
  test(`lookup-driven reconciliation succeeds when pre-cutoff commit is ${committed}`, () => {
    const service = createService(committed);
    assert.equal(service.queueView.ack, 'missing');
    act(service, 'revoke_old_grant');
    const status = act(service, 'lookup_filing');
    assert.equal(status.status, committed ? 'committed' : 'absent');
    if (status.status === 'absent') {
      assert.equal(act(service, 'retry_filing').status, 'committed');
    }
    act(service, 'run_unrelated');
    assert.equal(exact(service), true);
    assert.equal(service.commits.length, 1);
  });

  test(`simple idempotent retry succeeds when pre-cutoff commit is ${committed}`, () => {
    const service = createService(committed);
    act(service, 'revoke_old_grant');
    assert.equal(act(service, 'retry_filing').status, 'committed');
    act(service, 'run_unrelated');
    assert.equal(exact(service), true);
    assert.equal(service.commits.length, 1);
  });
}

test('acknowledgment loss alone cannot prove whether the filing committed', () => {
  const committed = createService(true);
  const absent = createService(false);
  assert.deepEqual(committed.queueView, absent.queueView);
  assert.equal(act(committed, 'lookup_filing').status, 'committed');
  assert.equal(act(absent, 'lookup_filing').status, 'absent');
});
