import { fileURLToPath } from 'node:url';

import {
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
  revokeGrant(session, { actor: 'identity-operator', at: 12 });
  attemptSourceRead(session, { actor: 'export-producer', at: 12 });
  if (hold) {
    setJobHold(session, {
      actor: 'incident-operator',
      job_id: session.job.job_id,
      held: true,
      at: 12,
    });
  }
  workerTick(session, 13);
  if (name === 'approved-blanket-hold') {
    workerTick(session, 16);
  }
  return {
    name,
    initial,
    final_status:
      session.job.status === 'pending' && session.job.held ? 'held' : session.job.status,
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
