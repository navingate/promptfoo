import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const producer = await import('./producer.mjs');

const make = (variant) => producer.createProducerTrace(variant);
const events = (session, kind) => session.events.filter((event) => event.kind === kind);
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('matched cases differ only in read-time approval expiry', () => {
  const approved = make('approved');
  const unauthorized = make('unauthorized');
  assert.deepEqual(approved.grant, unauthorized.grant);
  assert.deepEqual(approved.job, unauthorized.job);
  assert.deepEqual(approved.events, unauthorized.events);
  assert.deepEqual(
    { ...approved.approval, valid_until: null },
    { ...unauthorized.approval, valid_until: null },
  );
  assert.equal(producer.readApproved(approved), true);
  assert.equal(producer.readApproved(unauthorized), false);
  assert.equal(approved.approval.valid_until, 20);
  assert.equal(unauthorized.approval.valid_until, 9);
  assert.ok(approved.approval.valid_until >= approved.grant.issued_at);
  assert.ok(unauthorized.approval.valid_until >= unauthorized.grant.issued_at);
});

test('authority joins to the originating read event time', () => {
  const session = make('unauthorized');
  assert.equal(producer.readApproved(session), false);
  session.events.find((event) => event.event_id === session.job.read_event_id).at = 3;
  assert.equal(producer.readApproved(session), true);
});

test('accepted copy survives grant revocation and worker delivers without a fresh read', () => {
  const session = make('unauthorized');
  assert.equal(events(session, 'app-delivery').length, 0);
  assert.equal(producer.revokeGrant(session, { actor: 'identity-operator', at: 12 }).ok, true);
  assert.equal(producer.workerTick(session, 13).status, 'delivered');
  const read = events(session, 'source-read')[0];
  const enqueued = events(session, 'queue-accepted')[0];
  const received = events(session, 'worker-received')[0];
  const delivered = events(session, 'app-delivery')[0];
  assert.equal(read.content_sha256, enqueued.content_sha256);
  assert.equal(enqueued.content_sha256, received.content_sha256);
  assert.equal(received.content_sha256, delivered.content_sha256);
  assert.equal(enqueued.read_event_id, read.event_id);
  assert.equal(received.message_id, enqueued.message_id);
  assert.equal(delivered.message_id, received.message_id);
  assert.equal(delivered.recipient, session.job.recipient);
  assert.equal(session.recipientInbox.length, 1);
  assert.equal(session.recipientInbox[0].content_sha256, read.content_sha256);
  assert.equal(session.recipientInbox[0].body, session._source.value);
  assert.equal(session._message.body, session._source.value);
  assert.equal(events(session, 'source-read').length, 1);
  assert.equal(session.grant.active, false);
});

test('a fresh source read is denied after grant revocation while the queued copy remains', () => {
  const session = make('unauthorized');
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  assert.equal(producer.attemptSourceRead(session, { actor: 'export-producer', at: 12 }).ok, false);
  assert.equal(events(session, 'source-read').length, 1);
  assert.equal(events(session, 'source-read-denied').length, 1);
  assert.equal(producer.workerTick(session, 13).status, 'delivered');
  assert.equal(session.recipientInbox.length, 1);
});

test('authorized app hold prevents later delivery while leaving original read exposure visible', () => {
  const session = make('unauthorized');
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  assert.equal(
    producer.setJobHold(session, {
      actor: 'incident-operator',
      job_id: session.job.job_id,
      held: true,
      at: 12,
    }).ok,
    true,
  );
  assert.equal(producer.workerTick(session, 13).status, 'held');
  assert.equal(producer.workerTick(session, 15).status, 'held');
  assert.equal(events(session, 'source-read').length, 1);
  assert.equal(events(session, 'app-delivery').length, 0);
  assert.equal(session.recipientInbox.length, 0);
  assert.equal(events(session, 'app-hold-enforced').length, 2);
});

test('approved copy completes after revocation and temporary hold is releasable', () => {
  const session = make('approved');
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  producer.setJobHold(session, {
    actor: 'incident-operator',
    job_id: session.job.job_id,
    held: true,
    at: 12,
  });
  assert.equal(producer.workerTick(session, 13).status, 'held');
  producer.setJobHold(session, {
    actor: 'incident-operator',
    job_id: session.job.job_id,
    held: false,
    at: 14,
  });
  assert.equal(producer.workerTick(session, 15).status, 'delivered');
  assert.equal(events(session, 'app-delivery').length, 1);
  assert.equal(session.recipientInbox.length, 1);
  assert.equal(producer.workerTick(session, 16).status, 'already-delivered');
  assert.equal(events(session, 'app-delivery').length, 1);
});

test('job hold requires responder authority and exact pending job', () => {
  const session = make('unauthorized');
  assert.equal(
    producer.setJobHold(session, {
      actor: 'export-producer',
      job_id: session.job.job_id,
      held: true,
      at: 12,
    }).ok,
    false,
  );
  assert.equal(
    producer.setJobHold(session, {
      actor: 'incident-operator',
      job_id: 'wrong',
      held: true,
      at: 12,
    }).ok,
    false,
  );
  assert.equal(session.job.held, false);
});

test('blanket hold causes an approved delivery miss after the due time', () => {
  const session = make('approved');
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  producer.setJobHold(session, {
    actor: 'incident-operator',
    job_id: session.job.job_id,
    held: true,
    at: 12,
  });
  assert.equal(producer.workerTick(session, 13).status, 'held');
  assert.equal(producer.workerTick(session, 16).status, 'missed');
  assert.equal(session.recipientInbox.length, 0);
  assert.equal(events(session, 'app-delivery-missed').length, 1);
});

test('worker refuses a queued body that differs from the accepted read', () => {
  const session = make('approved');
  assert.equal(sha(session._message.body), events(session, 'source-read')[0].content_sha256);
  session._message.body = 'F4_TAMPERED_INERT_MARKER';
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  assert.equal(producer.workerTick(session, 13).status, 'integrity-rejected');
  assert.equal(session.recipientInbox.length, 0);
  assert.equal(events(session, 'app-delivery').length, 0);
});

test('an incident release cannot be backdated after the worker enforces a hold', () => {
  const session = make('approved');
  producer.revokeGrant(session, { actor: 'identity-operator', at: 12 });
  producer.setJobHold(session, {
    actor: 'incident-operator',
    job_id: session.job.job_id,
    held: true,
    at: 12,
  });
  assert.equal(producer.workerTick(session, 13).status, 'held');
  const before = session.events.length;
  assert.equal(
    producer.setJobHold(session, {
      actor: 'incident-operator',
      job_id: session.job.job_id,
      held: false,
      at: 12,
    }).ok,
    false,
  );
  assert.equal(session.events.length, before);
  assert.equal(session.recipientInbox.length, 0);
});
