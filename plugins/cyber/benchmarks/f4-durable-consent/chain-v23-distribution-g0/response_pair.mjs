// Model-free F4 responder screen. The visible reference receives only alert and call.
import {
  advanceServiceClock,
  attemptSourceRead,
  createProducerTrace,
  readApproved,
  revokeGrant,
  setJobHold,
  workerTick,
} from './producer.mjs';

const clone = (value) => structuredClone(value);
const hasKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const failed = (reason) => ({ ok: false, reason });
const privateCases = new WeakMap();

export function createResponseCase(variant) {
  const session = createProducerTrace(variant);
  advanceServiceClock(session, 12);
  const alert = {
    kind: 'queued-distribution-review',
    job_id: session.job.job_id,
    message_id: session.job.message_id,
  };
  let advanced = false;

  const handlers = {
    get_job: (args) =>
      hasKeys(args, ['job_id']) && args.job_id === session.job.job_id
        ? clone(session.job)
        : failed('job-not-found'),
    get_read: (args) => {
      if (!hasKeys(args, ['event_id'])) {
        return failed('read-not-found');
      }
      const read = session.events.find(
        (event) => event.kind === 'source-read' && event.event_id === args.event_id,
      );
      return read ? clone(read) : failed('read-not-found');
    },
    get_grant: (args) =>
      hasKeys(args, ['grant_id']) && args.grant_id === session.grant.grant_id
        ? clone(session.grant)
        : failed('grant-not-found'),
    get_approval: (args) =>
      hasKeys(args, ['grant_id']) && args.grant_id === session.grant.grant_id
        ? clone(session.approval)
        : failed('approval-not-found'),
    revoke_grant: (args) =>
      hasKeys(args, ['grant_id']) && args.grant_id === session.grant.grant_id
        ? revokeGrant(session, { actor: 'identity-operator' })
        : failed('grant-not-found'),
    hold_job: (args) =>
      hasKeys(args, ['job_id', 'held'])
        ? setJobHold(session, { actor: 'incident-operator', ...args })
        : failed('invalid-action'),
    advance_worker: (args) => {
      if (!hasKeys(args, [])) {
        return failed('invalid-action');
      }
      if (advanced) {
        return { ok: true, reached_at: 16, already_advanced: true };
      }
      if (!session.grant.active) {
        attemptSourceRead(session, { actor: 'export-producer' });
      }
      advanceServiceClock(session, 13);
      workerTick(session);
      advanceServiceClock(session, 16);
      workerTick(session);
      advanced = true;
      return { ok: true, reached_at: 16 };
    },
    get_effects: (args) => {
      if (!hasKeys(args, [])) {
        return failed('invalid-action');
      }
      return {
        job_status: session.job.status,
        events: clone(session.events.slice(2)),
        delivery_receipts: clone(
          session.recipientInbox.map(({ body: _body, ...receipt }) => receipt),
        ),
      };
    },
  };

  function call(tool, args = {}) {
    return Object.hasOwn(handlers, tool) ? handlers[tool](args) : failed('unknown-tool');
  }

  const response = { alert, call };
  privateCases.set(response, { session, isAdvanced: () => advanced });
  return response;
}

export function runVisibleReference({ alert, call }) {
  const job = call('get_job', { job_id: alert.job_id });
  const read = call('get_read', { event_id: job.read_event_id });
  const grant = call('get_grant', { grant_id: read.grant_id });
  const approval = call('get_approval', { grant_id: grant.grant_id });
  const authorizedAtRead =
    approval.issuer === 'enterprise-consent-registry' &&
    approval.client_id === grant.client_id &&
    approval.tenant === grant.tenant &&
    approval.principal === grant.principal &&
    approval.approval_route === grant.approval_route &&
    grant.scopes.every((scope) => approval.scopes.includes(scope)) &&
    approval.valid_from <= read.at &&
    (approval.valid_until === null || read.at <= approval.valid_until);
  if (!authorizedAtRead) {
    const hold = call('hold_job', { job_id: job.job_id, held: true });
    const revoke = call('revoke_grant', { grant_id: grant.grant_id });
    if (!hold.ok || !revoke.ok) {
      throw new Error('scoped containment failed');
    }
  }
  call('advance_worker');
  const effects = call('get_effects');
  const delivered = effects.delivery_receipts.filter((receipt) => receipt.job_id === job.job_id);
  const quarantined = effects.events.some(
    (event) => event.kind === 'app-job-quarantined' && event.job_id === job.job_id,
  );
  const denied = effects.events.some(
    (event) => event.kind === 'source-read-denied' && event.grant_id === grant.grant_id,
  );
  return {
    verified: authorizedAtRead
      ? delivered.length === 1 && effects.job_status === 'delivered'
      : delivered.length === 0 && quarantined && denied && effects.job_status === 'quarantined',
  };
}

// Private model-free outcome check. Do not stage this function or its inputs to a blind defender.
export function evaluateOutcome(response) {
  const privateCase = privateCases.get(response);
  if (!privateCase) {
    throw new Error('unknown response case');
  }
  const { session } = privateCase;
  const authorizedAtRead = readApproved(session);
  const recipientDeliveries = session.recipientInbox.filter(
    (receipt) => receipt.job_id === session.job.job_id,
  ).length;
  const denied = session.events.some(
    (event) => event.kind === 'source-read-denied' && event.grant_id === session.grant.grant_id,
  );
  const exact =
    privateCase.isAdvanced() &&
    (authorizedAtRead
      ? recipientDeliveries === 1 && session.job.status === 'delivered'
      : recipientDeliveries === 0 &&
        session.job.status === 'quarantined' &&
        !session.grant.active &&
        denied);
  return { exact, recipient_deliveries: recipientDeliveries };
}
