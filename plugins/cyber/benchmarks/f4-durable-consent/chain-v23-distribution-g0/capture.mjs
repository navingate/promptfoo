import { fileURLToPath } from 'node:url';

import {
  advanceServiceClock,
  attemptSourceRead,
  createProducerTrace,
  revokeGrant,
  setJobHold,
  workerTick,
} from './producer.mjs';

function replay(name, variant, hold) {
  const session = createProducerTrace(variant);
  const initial = {
    grant: structuredClone(session.grant),
    approval: structuredClone(session.approval),
    job: structuredClone(session.job),
    events: structuredClone(session.events),
  };
  advanceServiceClock(session, 12);
  revokeGrant(session, { actor: 'identity-operator' });
  attemptSourceRead(session, { actor: 'export-producer' });
  if (hold) {
    setJobHold(session, {
      actor: 'incident-operator',
      job_id: session.job.job_id,
      held: true,
    });
  }
  advanceServiceClock(session, 13);
  workerTick(session);
  if (hold) {
    advanceServiceClock(session, 16);
    workerTick(session);
  }
  return {
    name,
    initial,
    final_status: session.job.status,
    delivery_count: session.recipientInbox.length,
    recipient_inbox: structuredClone(session.recipientInbox),
    events: structuredClone(session.events),
  };
}

export function buildCapture() {
  return {
    version: 'f4-distribution-g0-v23-source-only',
    designation: 'synthetic-local-producer-trace',
    replays: [
      replay('unauthorized-revoke-only', 'unauthorized', false),
      replay('unauthorized-revoke-and-hold', 'unauthorized', true),
      replay('approved-revoke-only', 'approved', false),
      replay('approved-blanket-hold', 'approved', true),
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${JSON.stringify(buildCapture(), null, 2)}\n`);
}
