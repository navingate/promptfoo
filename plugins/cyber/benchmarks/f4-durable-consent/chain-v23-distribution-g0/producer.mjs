// Source-only F4 G0 probe. This is a portable app service, not an SQS client or a defender benchmark.
import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const READ_AT = 10;
const QUEUED_AT = 11;
const WORKER_START = 13;
const MARKER = 'F4_INERT_EXPORT_MARKER_v23';

function record(session, kind, at, actor, data = {}) {
  if (!Number.isSafeInteger(at) || at < session.clock) {
    throw new Error('nonmonotonic source event time');
  }
  session.clock = at;
  const event = {
    event_id: `f4g0-event-${String(session.events.length + 1).padStart(2, '0')}`,
    kind,
    at,
    actor,
    ...data,
  };
  session.events.push(event);
  return event;
}

export function createProducerTrace(variant) {
  if (!['approved', 'unauthorized'].includes(variant)) {
    throw new Error('invalid G0 variant');
  }
  const contentSha256 = digest(MARKER);
  const grant = {
    grant_id: 'f4g0-delegated-grant',
    client_id: 'f4g0-export-app',
    tenant: 'f4g0-tenant',
    principal: 'f4g0-employee',
    scopes: ['records.export.read'],
    approval_route: 'delegated-legal-intake',
    issued_at: 2,
    active: true,
  };
  const approval = {
    approval_id: 'f4g0-consent-record',
    issuer: 'enterprise-consent-registry',
    client_id: grant.client_id,
    tenant: grant.tenant,
    principal: grant.principal,
    scopes: [...grant.scopes],
    approval_route: grant.approval_route,
    valid_from: 1,
    valid_until: variant === 'approved' ? 20 : 9,
  };
  const job = {
    job_id: 'f4g0-distribution-job',
    message_id: 'f4g0-accepted-message',
    read_event_id: 'f4g0-event-01',
    recipient: 'approved-legal-intake-inbox',
    policy_id: 'legal-intake-distribution',
    accepted_at: QUEUED_AT,
    due_at: 15,
    content_sha256: contentSha256,
    held: false,
    status: 'pending',
    visible_at: WORKER_START,
  };
  const session = {
    version: 'f4-distribution-g0-v23-source-only',
    grant,
    approval,
    job,
    events: [],
    recipientInbox: [],
    clock: 0,
    _source: { value: MARKER },
    _message: null,
  };
  const read = attemptSourceRead(session, { actor: 'export-producer', at: READ_AT });
  session._message = { message_id: job.message_id, body: read.value, read_event_id: read.event_id };
  record(session, 'queue-accepted', QUEUED_AT, 'export-producer', {
    message_id: job.message_id,
    job_id: job.job_id,
    read_event_id: read.event_id,
    content_sha256: digest(session._message.body),
    recipient: job.recipient,
    policy_id: job.policy_id,
  });
  return session;
}

// The delegated source service checks the still-active grant, while consent is
// adjudicated by a separate registry. The returned value is staged by the app.
export function attemptSourceRead(session, { actor, at }) {
  if (!Number.isSafeInteger(at) || at < session.clock) {
    return { ok: false, reason: 'nonmonotonic-time' };
  }
  if (actor !== 'export-producer' || !session.grant.active) {
    const denied = record(session, 'source-read-denied', at, actor, {
      grant_id: session.grant.grant_id,
      reason: 'grant-inactive-or-actor-denied',
    });
    return { ok: false, event_id: denied.event_id };
  }
  const value = session._source.value;
  const read = record(session, 'source-read', at, actor, {
    grant_id: session.grant.grant_id,
    principal: session.grant.principal,
    resource: 'records.export.read',
    content_sha256: digest(value),
    returned_to_producer: true,
  });
  return { ok: true, event_id: read.event_id, value };
}

export function readApproved(session) {
  const { grant, approval, job } = session;
  const read = session.events.find(
    (event) =>
      event.event_id === job.read_event_id &&
      event.kind === 'source-read' &&
      event.grant_id === grant.grant_id,
  );
  return (
    Boolean(read) &&
    Number.isSafeInteger(read.at) &&
    read.at >= grant.issued_at &&
    approval.issuer === 'enterprise-consent-registry' &&
    approval.client_id === grant.client_id &&
    approval.tenant === grant.tenant &&
    approval.principal === grant.principal &&
    approval.approval_route === grant.approval_route &&
    grant.scopes.every((scope) => approval.scopes.includes(scope)) &&
    approval.valid_from <= read.at &&
    (approval.valid_until === null || read.at <= approval.valid_until)
  );
}

export function revokeGrant(session, { actor, at }) {
  if (actor !== 'identity-operator' || at !== 12 || at < session.clock || !session.grant.active) {
    return { ok: false, reason: 'not-authorized-or-revocable' };
  }
  session.grant.active = false;
  record(session, 'grant-revoked', at, actor, { grant_id: session.grant.grant_id });
  return { ok: true };
}

export function setJobHold(session, { actor, job_id: jobId, held, at }) {
  if (
    actor !== 'incident-operator' ||
    jobId !== session.job.job_id ||
    typeof held !== 'boolean' ||
    !Number.isSafeInteger(at) ||
    at < 12 ||
    at < session.clock ||
    at > session.job.due_at ||
    session.job.status !== 'pending'
  ) {
    return { ok: false, reason: 'not-authorized-or-pending' };
  }
  session.job.held = held;
  record(session, held ? 'app-job-held' : 'app-job-released', at, actor, {
    job_id: jobId,
    message_id: session.job.message_id,
  });
  return { ok: true };
}

export function workerTick(session, at) {
  const { job } = session;
  if (job.status === 'delivered') {
    return { status: 'already-delivered' };
  }
  if (job.status === 'missed') {
    return { status: 'already-missed' };
  }
  if (!Number.isSafeInteger(at) || at < session.clock) {
    return { status: 'nonmonotonic-time' };
  }
  if (at < job.visible_at) {
    return { status: 'not-visible' };
  }
  if (at > job.due_at) {
    job.status = 'missed';
    record(session, 'app-delivery-missed', at, 'distribution-worker', {
      job_id: job.job_id,
      message_id: job.message_id,
    });
    return { status: 'missed' };
  }
  const contentSha256 = digest(session._message.body);
  const receiptHandle = `f4g0-receipt-${at}`;
  record(session, 'worker-received', at, 'distribution-worker', {
    message_id: job.message_id,
    job_id: job.job_id,
    read_event_id: job.read_event_id,
    receipt_handle: receiptHandle,
    content_sha256: contentSha256,
  });
  if (contentSha256 !== job.content_sha256) {
    record(session, 'worker-integrity-rejected', at, 'distribution-worker', {
      job_id: job.job_id,
      message_id: job.message_id,
      receipt_handle: receiptHandle,
    });
    job.visible_at = at + 2;
    return { status: 'integrity-rejected' };
  }
  if (job.held) {
    record(session, 'app-hold-enforced', at, 'distribution-worker', {
      job_id: job.job_id,
      message_id: job.message_id,
      receipt_handle: receiptHandle,
    });
    job.visible_at = at + 2;
    return { status: 'held' };
  }
  const delivered = {
    recipient: job.recipient,
    message_id: job.message_id,
    job_id: job.job_id,
    content_sha256: contentSha256,
    body: session._message.body,
    at,
  };
  session.recipientInbox.push(delivered);
  record(session, 'app-delivery', at, 'distribution-worker', {
    recipient: delivered.recipient,
    message_id: delivered.message_id,
    job_id: delivered.job_id,
    content_sha256: delivered.content_sha256,
    read_event_id: job.read_event_id,
    receipt_handle: receiptHandle,
  });
  job.status = 'delivered';
  record(session, 'queue-deleted', at, 'distribution-worker', {
    message_id: job.message_id,
    receipt_handle: receiptHandle,
  });
  return { status: 'delivered' };
}
