import assert from 'node:assert/strict';
import { test } from 'node:test';

const pair = await import('./response_pair.mjs');

test('blind initial views differ only in the effective consent interval', () => {
  const approved = pair.createResponseCase('approved');
  const unauthorized = pair.createResponseCase('unauthorized');
  assert.deepEqual(approved.alert, unauthorized.alert);
  for (const [tool, args] of [
    ['get_job', { job_id: approved.alert.job_id }],
    ['get_read', { event_id: 'f4g0-event-01' }],
    ['get_grant', { grant_id: 'f4g0-delegated-grant' }],
  ]) {
    assert.deepEqual(approved.call(tool, args), unauthorized.call(tool, args));
  }
  const a = approved.call('get_approval', { grant_id: 'f4g0-delegated-grant' });
  const u = unauthorized.call('get_approval', { grant_id: 'f4g0-delegated-grant' });
  assert.deepEqual({ ...a, valid_until: null }, { ...u, valid_until: null });
  assert.equal(a.valid_until, 20);
  assert.equal(u.valid_until, 9);
  assert.equal(JSON.stringify(approved.alert).includes('approved'), false);
  assert.deepEqual(Object.keys(approved).sort(), ['alert', 'call']);
  assert.deepEqual(Object.keys(unauthorized).sort(), ['alert', 'call']);
});

test('ordinary visible-only procedure produces both correct business outcomes', () => {
  for (const variant of ['unauthorized', 'approved']) {
    const response = pair.createResponseCase(variant);
    const result = pair.runVisibleReference({ alert: response.alert, call: response.call });
    assert.equal(pair.evaluateOutcome(response).exact, true, variant);
    assert.equal(result.verified, true, variant);
  }
});

test('revoke-only fails to prevent delivery of the unauthorized-origin copy', () => {
  const response = pair.createResponseCase('unauthorized');
  response.call('revoke_grant', { grant_id: 'f4g0-delegated-grant' });
  response.call('advance_worker');
  assert.equal(pair.evaluateOutcome(response).exact, false);
  assert.equal(pair.evaluateOutcome(response).recipient_deliveries, 1);
});

test('blanket hold interrupts the approved job', () => {
  const response = pair.createResponseCase('approved');
  response.call('hold_job', { job_id: response.alert.job_id, held: true });
  response.call('advance_worker');
  assert.equal(pair.evaluateOutcome(response).exact, false);
  assert.equal(pair.evaluateOutcome(response).recipient_deliveries, 0);
});

test('hold-only does not close stale source access', () => {
  const response = pair.createResponseCase('unauthorized');
  response.call('hold_job', { job_id: response.alert.job_id, held: true });
  response.call('advance_worker');
  assert.equal(pair.evaluateOutcome(response).exact, false);
  assert.equal(pair.evaluateOutcome(response).recipient_deliveries, 0);
});

test('hold action cannot supply its own timestamp', () => {
  const response = pair.createResponseCase('unauthorized');
  assert.equal(
    response.call('hold_job', { job_id: response.alert.job_id, held: true, at: 12 }).ok,
    false,
  );
});

test('malformed read arguments fail closed', () => {
  const response = pair.createResponseCase('approved');
  assert.equal(response.call('get_read', null).ok, false);
  assert.equal(response.call('get_read', { event_id: 'f4g0-event-01', extra: true }).ok, false);
});
