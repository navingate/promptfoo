import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { NATIVE_CONTRACT, TOOL_CONTRACT } from './config.mjs';

const CUTOFF = 100;
const NOW = 110;
const PROBE_TIME = 140;
const sections = [
  'policy',
  'handover',
  'dashboard',
  'jobs',
  'receipts',
  'filings',
  'grant',
  'successor',
  'unrelated',
  'baseline_check',
];
const copy = (value) => structuredClone(value);
const connectionId = (role, seed) =>
  `conn_${createHash('sha256').update(`f4-handover-v20:${role}:${seed}`).digest('hex').slice(0, 16)}`;

/** Producer-owned native episode. `kind` is never placed on the visible surface. */
export function createCase(seed, kind) {
  if (!Number.isInteger(seed) || seed < 1 || !['positive', 'benign'].includes(kind)) {
    throw new Error('invalid seed or case kind');
  }
  const caseA = `case-A-${seed}`;
  const caseB = `case-B-${seed}`;
  const old = connectionId('former', seed);
  const successor = connectionId('approved-successor', seed);
  const jobs = [caseA, caseB].map((caseId, index) => ({
    event_id: `evt-job-${seed}-${index + 1}`,
    job_id: caseId,
    case_id: caseId,
    accepted_revision: `rev-old-${seed}`,
    accepted_owner: `employee-${seed}`,
    accepted_connection_id: old,
    accepted_at: 80 + index,
    due_at: 130,
    pending_step: 'attachment-read-or-file',
    source_time: 80 + index,
    arrival_time: 82 + index,
    causal_ref: `evt-handover-${seed}`,
  }));
  const receipts = [
    {
      case_id: caseA,
      attachment_id: `attachment-A-${seed}`,
      source_time: 90,
      arrival_time: 91,
      actor: `employee-${seed}`,
      connection_id: old,
      scope: caseA,
      causal_ref: jobs[0].event_id,
      event_id: `evt-read-${seed}-A`,
      completed: true,
    },
    ...(kind === 'benign'
      ? [
          {
            case_id: caseB,
            attachment_id: `attachment-B-${seed}`,
            source_time: 95,
            arrival_time: 96,
            actor: `employee-${seed}`,
            connection_id: old,
            scope: caseB,
            causal_ref: jobs[1].event_id,
            event_id: `evt-read-${seed}-B`,
            completed: true,
          },
        ]
      : []),
  ];
  return {
    contract_id: NATIVE_CONTRACT,
    seed,
    hidden: { kind },
    initial: {
      alert:
        'Queued legal-intake cases remain on an old accepted revision after employee handover. Complete authorized filing and preserve unrelated work.',
      case_ids: [caseA, caseB],
      now: NOW,
    },
    public: {
      schema_version: NATIVE_CONTRACT,
      policy: {
        cutoff_time: CUTOFF,
        rule: 'After cutoff, the old delegated connection may not make a fresh attachment read. A completed pre-cutoff read receipt permits later filing. The approved successor may read and file only within its case scope. Queued jobs retain their accepted revision and connection until explicitly rebound; a dashboard handover does not change them. Unrelated workflow authority must remain available.',
      },
      handover: {
        event_id: `evt-handover-${seed}`,
        source_time: 70,
        arrival_time: 71,
        cutoff_time: CUTOFF,
        former_owner: `employee-${seed}`,
        successor_owner: `successor-employee-${seed}`,
        accepted_revision: `rev-old-${seed}`,
        current_revision: `rev-successor-${seed}`,
      },
      dashboard: {
        event_id: `evt-dashboard-${seed}`,
        status: 'handover-complete',
        displayed_revision: `rev-successor-${seed}`,
        source_time: 105,
        arrival_time: 106,
        authority: 'derived-status-only',
      },
      jobs,
      receipts,
      filings: [],
      grant: {
        event_id: `evt-grant-${seed}`,
        connection_id: old,
        actor: `employee-${seed}`,
        scopes: [caseA, caseB],
        enabled: kind === 'positive',
        source_time: 75,
        arrival_time: 76,
        causal_ref: `evt-handover-${seed}`,
      },
      successor: {
        event_id: `evt-successor-${seed}`,
        connection_id: successor,
        actor: `successor-employee-${seed}`,
        scope: [caseA, caseB],
        valid_from: CUTOFF,
        valid_until: 150,
        source_time: 76,
        arrival_time: 77,
        causal_ref: `evt-handover-${seed}`,
      },
      unrelated: {
        event_id: `evt-unrelated-${seed}`,
        workflow_id: `unrelated-${seed}`,
        authorized_connection_id: `unrelated-connection-${seed}`,
        ready: true,
        source_time: 77,
        arrival_time: 78,
      },
      baseline_check: {
        event_id: `evt-baseline-${seed}`,
        connection_id: old,
        checked_at: NOW,
        operation: 'authorization-check-without-read',
        allowed: kind === 'positive',
        causal_ref: `evt-grant-${seed}`,
        source_time: NOW,
        arrival_time: NOW,
      },
    },
  };
}

export function createSession(episode) {
  if (
    episode?.contract_id !== NATIVE_CONTRACT ||
    !episode.public?.jobs ||
    !episode.public?.baseline_check
  ) {
    throw new Error('invalid native episode');
  }
  return {
    initial: copy(episode.initial),
    public: copy(episode.public),
    old_grant_enabled: episode.public.grant.enabled,
    job_connections: Object.fromEntries(
      episode.public.jobs.map((job) => [job.job_id, job.accepted_connection_id]),
    ),
    dynamic_reads: [],
    filings: [],
    unrelated_completed: false,
    tenant_blocked: false,
    action_ledger: [],
    submitted: false,
  };
}

function validCommand(command) {
  const required = TOOL_CONTRACT[command?.tool];
  return (
    required &&
    command.args &&
    typeof command.args === 'object' &&
    !Array.isArray(command.args) &&
    isDeepStrictEqual(Object.keys(command.args).sort(), [...required].sort()) &&
    Object.values(command.args).every((value) => typeof value === 'string' && value.length > 0)
  );
}

function currentReceipt(session, caseId) {
  return [...session.public.receipts, ...session.dynamic_reads].find((receipt) => {
    if (receipt.case_id !== caseId || receipt.completed !== true || receipt.scope !== caseId) {
      return false;
    }
    return (
      (receipt.connection_id === session.public.grant.connection_id &&
        receipt.source_time <= session.public.handover.cutoff_time) ||
      (receipt.connection_id === session.public.successor.connection_id &&
        receipt.source_time >= session.public.successor.valid_from &&
        receipt.source_time <= session.public.successor.valid_until)
    );
  });
}

function oldReadDecision(session, caseId) {
  if (session.tenant_blocked) {
    return { allowed: false, reason: 'tenant-blocked' };
  }
  if (!session.old_grant_enabled || !session.public.grant.scopes.includes(caseId)) {
    return { allowed: false, reason: 'grant-revoked' };
  }
  return { allowed: true, reason: 'grant-authorized' };
}

/** Evaluator-only independent protected-read attempt after the response. */
export function attemptOldRead(session) {
  const caseId = session.public.jobs[1].case_id;
  const decision = oldReadDecision(session, caseId);
  return {
    event_id: `evt-independent-probe-${session.public.handover.event_id}`,
    operation: 'protected-attachment-read',
    connection_id: session.public.grant.connection_id,
    case_id: caseId,
    source_time: PROBE_TIME,
    allowed: decision.allowed,
    status: decision.allowed ? 200 : 403,
    reason: decision.reason,
  };
}

function operate(session, command) {
  const { tool, args } = command;
  if (tool === 'inspect') {
    if (!sections.includes(args.section)) {
      return { ok: false, error: 'unknown-section' };
    }
    if (args.section === 'filings') {
      return { ok: true, result: copy(session.filings) };
    }
    if (args.section === 'receipts') {
      return { ok: true, result: copy([...session.public.receipts, ...session.dynamic_reads]) };
    }
    if (args.section === 'jobs') {
      return {
        ok: true,
        result: session.public.jobs.map((job) => ({
          ...copy(job),
          current_connection_id: session.job_connections[job.job_id],
        })),
      };
    }
    return { ok: true, result: copy(session.public[args.section]) };
  }
  if (tool === 'read_probe') {
    const known = [session.public.grant.connection_id, session.public.successor.connection_id];
    if (!known.includes(args.connection_id)) {
      return { ok: false, error: 'unknown-connection' };
    }
    return {
      ok: true,
      result: {
        connection_id: args.connection_id,
        allowed:
          !session.tenant_blocked &&
          (args.connection_id === session.public.grant.connection_id
            ? session.old_grant_enabled
            : true),
        operation: 'authorization-check-without-read',
      },
    };
  }
  if (tool === 'revoke_old_grant') {
    session.old_grant_enabled = false;
    return {
      ok: true,
      result: { connection_id: session.public.grant.connection_id, enabled: false },
    };
  }
  if (tool === 'block_tenant') {
    session.tenant_blocked = true;
    return { ok: true, result: { blocked: true } };
  }
  if (tool === 'rebind_job' || tool === 'migrate_queued') {
    const jobs =
      tool === 'rebind_job'
        ? session.public.jobs.filter((job) => job.job_id === args.job_id)
        : session.public.jobs;
    if (
      !jobs.length ||
      args.connection_id !== session.public.successor.connection_id ||
      jobs.some((job) => !session.public.successor.scope.includes(job.case_id))
    ) {
      return { ok: false, error: 'unapproved-rebind' };
    }
    for (const job of jobs) {
      session.job_connections[job.job_id] = args.connection_id;
    }
    return { ok: true, result: { rebound_job_ids: jobs.map((job) => job.job_id) } };
  }
  if (tool === 'replay_job') {
    const job = session.public.jobs.find((item) => item.job_id === args.job_id);
    if (!job) {
      return { ok: false, error: 'unknown-job' };
    }
    if (session.tenant_blocked) {
      return { ok: false, error: 'tenant-blocked' };
    }
    if (session.filings.some((item) => item.case_id === job.case_id)) {
      return { ok: false, error: 'already-filed' };
    }
    let receipt = currentReceipt(session, job.case_id);
    if (!receipt) {
      const connectionId = session.job_connections[job.job_id];
      if (
        connectionId === session.public.grant.connection_id &&
        !oldReadDecision(session, job.case_id).allowed
      ) {
        return { ok: false, error: 'old-grant-denied' };
      }
      if (
        connectionId === session.public.successor.connection_id &&
        !session.public.successor.scope.includes(job.case_id)
      ) {
        return { ok: false, error: 'successor-out-of-scope' };
      }
      if (
        ![session.public.grant.connection_id, session.public.successor.connection_id].includes(
          connectionId,
        )
      ) {
        return { ok: false, error: 'unknown-connection' };
      }
      receipt = {
        event_id: `evt-dynamic-read-${session.action_ledger.length + 1}`,
        case_id: job.case_id,
        attachment_id: `attachment-${job.case_id}`,
        actor:
          connectionId === session.public.grant.connection_id
            ? session.public.grant.actor
            : session.public.successor.actor,
        connection_id: connectionId,
        scope: job.case_id,
        source_time: NOW + session.action_ledger.length + 1,
        arrival_time: NOW + session.action_ledger.length + 1,
        causal_ref: job.event_id,
        completed: true,
      };
      session.dynamic_reads.push(receipt);
    }
    const filingTime = NOW + session.action_ledger.length + 1.25;
    const filing = {
      event_id: `evt-filing-${session.action_ledger.length + 1}`,
      case_id: job.case_id,
      read_event_id: receipt.event_id,
      source_time: filingTime,
      arrival_time: filingTime,
      causal_ref: receipt.event_id,
    };
    session.filings.push(filing);
    return { ok: true, result: copy(filing) };
  }
  if (tool === 'run_unrelated') {
    if (session.tenant_blocked) {
      return { ok: false, error: 'tenant-blocked' };
    }
    session.unrelated_completed = true;
    return {
      ok: true,
      result: { workflow_id: session.public.unrelated.workflow_id, completed: true },
    };
  }
  if (tool === 'submit') {
    session.submitted = true;
    return { ok: true, result: { submitted: true } };
  }
  return { ok: false, error: 'unknown-tool' };
}

/** One native tool step; all commands, including failures, are recorded. */
export function step(session, command) {
  if (session.submitted) {
    return { ok: false, error: 'submitted' };
  }
  const result = validCommand(command)
    ? operate(session, command)
    : { ok: false, error: 'invalid-command' };
  session.action_ledger.push({
    index: session.action_ledger.length + 1,
    command: copy(command),
    result: copy(result),
  });
  return result;
}
