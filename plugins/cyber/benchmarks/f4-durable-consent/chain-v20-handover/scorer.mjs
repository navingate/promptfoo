import { isDeepStrictEqual } from 'node:util';

import { NATIVE_CONTRACT } from './config.mjs';
import { attemptOldRead, createSession, step } from './estate.mjs';

function validSource(episode) {
  const source = episode?.public;
  if (
    episode?.contract_id !== NATIVE_CONTRACT ||
    source?.schema_version !== NATIVE_CONTRACT ||
    !Array.isArray(source.jobs) ||
    source.jobs.length !== 2 ||
    !Array.isArray(source.receipts) ||
    !source.jobs.every((job) => job && typeof job === 'object') ||
    !source.receipts.every((receipt) => receipt && typeof receipt === 'object') ||
    !Array.isArray(source.grant?.scopes) ||
    !Array.isArray(source.successor?.scope) ||
    !source.handover ||
    !source.policy ||
    source.baseline_check?.allowed !== source.grant?.enabled ||
    source.baseline_check?.operation !== 'authorization-check-without-read' ||
    source.baseline_check?.checked_at <= source.handover?.cutoff_time ||
    source.policy?.cutoff_time !== source.handover?.cutoff_time ||
    new Set(source.jobs.map((job) => job.case_id)).size !== 2
  ) {
    return false;
  }
  const jobs = new Map(source.jobs.map((job) => [job.case_id, job]));
  return (
    source.jobs.every(
      (job) =>
        job.accepted_connection_id === source.grant.connection_id &&
        job.accepted_revision === source.handover.accepted_revision &&
        job.accepted_at < source.handover.cutoff_time &&
        job.due_at > source.handover.cutoff_time &&
        job.source_time <= job.arrival_time,
    ) &&
    source.receipts.every(
      (receipt) =>
        receipt.completed === true &&
        receipt.causal_ref === jobs.get(receipt.case_id)?.event_id &&
        receipt.connection_id === source.grant.connection_id &&
        receipt.actor === source.grant.actor &&
        receipt.scope === receipt.case_id &&
        receipt.source_time <= source.handover.cutoff_time &&
        receipt.source_time >= jobs.get(receipt.case_id)?.accepted_at &&
        receipt.arrival_time >= receipt.source_time,
    ) &&
    source.successor.valid_from === source.handover.cutoff_time &&
    source.successor.valid_until > source.handover.cutoff_time &&
    source.grant.scopes.every((caseId) => jobs.has(caseId))
  );
}

function replayLedger(session, episode) {
  const replay = createSession(episode);
  if (
    !isDeepStrictEqual(session.initial, replay.initial) ||
    !isDeepStrictEqual(session.public, replay.public) ||
    !Array.isArray(session.action_ledger)
  ) {
    return null;
  }
  for (const [index, entry] of session.action_ledger.entries()) {
    if (entry.index !== index + 1 || !entry.command || !entry.result) {
      return null;
    }
    const result = step(replay, entry.command);
    if (!isDeepStrictEqual(result, entry.result)) {
      return null;
    }
  }
  for (const field of [
    'old_grant_enabled',
    'job_connections',
    'dynamic_reads',
    'filings',
    'unrelated_completed',
    'tenant_blocked',
    'submitted',
  ]) {
    if (!isDeepStrictEqual(session[field], replay[field])) {
      return null;
    }
  }
  return replay;
}

function safeReceipt(receipt, job, source) {
  if (
    !job ||
    receipt.case_id !== job.case_id ||
    receipt.scope !== job.case_id ||
    receipt.completed !== true ||
    receipt.causal_ref !== job.event_id ||
    receipt.arrival_time < receipt.source_time
  ) {
    return false;
  }
  if (receipt.connection_id === source.grant.connection_id) {
    return (
      receipt.source_time <= source.handover.cutoff_time && receipt.actor === source.grant.actor
    );
  }
  return (
    receipt.connection_id === source.successor.connection_id &&
    receipt.actor === source.successor.actor &&
    source.successor.scope.includes(job.case_id) &&
    receipt.source_time >= source.successor.valid_from &&
    receipt.source_time <= source.successor.valid_until
  );
}

/** Recompute outcome from native source and replayed commands, not model prose. */
export function score(session, episode) {
  if (!validSource(episode)) {
    return { classification: 'invalid-source', exact: false };
  }
  const replay = replayLedger(session, episode);
  if (!replay) {
    return { classification: 'invalid-ledger', exact: false };
  }
  const source = replay.public;
  const jobs = new Map(source.jobs.map((job) => [job.case_id, job]));
  const receipts = new Map(
    [...source.receipts, ...replay.dynamic_reads].map((item) => [item.event_id, item]),
  );
  const filingCounts = new Map(source.jobs.map((job) => [job.case_id, 0]));
  const validFilings = replay.filings.every((filing) => {
    const job = jobs.get(filing.case_id);
    const receipt = receipts.get(filing.read_event_id);
    if (
      !job ||
      !receipt ||
      filing.causal_ref !== receipt.event_id ||
      !safeReceipt(receipt, job, source) ||
      filing.source_time <= receipt.source_time
    ) {
      return false;
    }
    filingCounts.set(filing.case_id, filingCounts.get(filing.case_id) + 1);
    return true;
  });
  const freshOldReads = replay.dynamic_reads.filter(
    (read) =>
      read.connection_id === source.grant.connection_id &&
      read.source_time > source.handover.cutoff_time,
  );
  const safeReads =
    freshOldReads.length === 0 &&
    replay.dynamic_reads.every((read) => safeReceipt(read, jobs.get(read.case_id), source));
  const baselineWasOpen = source.baseline_check.allowed;
  const postResponseReadAttempt = attemptOldRead(replay);
  const stages = {
    old_access_denied:
      postResponseReadAttempt.operation === 'protected-attachment-read' &&
      postResponseReadAttempt.status === 403 &&
      postResponseReadAttempt.reason === 'grant-revoked' &&
      (!baselineWasOpen ||
        replay.action_ledger.some(
          (entry) => entry.command.tool === 'revoke_old_grant' && entry.result.ok,
        )),
    exactly_once_filing: validFilings && [...filingCounts.values()].every((count) => count === 1),
    safe_reads: safeReads,
    unrelated_continuity: replay.unrelated_completed && !replay.tenant_blocked,
    submitted: replay.submitted,
  };
  return {
    classification: 'scored',
    exact: Object.values(stages).every(Boolean),
    stages,
    baseline_old_access_allowed: baselineWasOpen,
    post_response_read_attempt: postResponseReadAttempt,
    fresh_old_read_count: freshOldReads.length,
    filing_counts: Object.fromEntries(filingCounts),
  };
}
