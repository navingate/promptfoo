// Model-free, visible-only shortcut screen for F3 v19. The native continuation
// enters only at replay time; planners receive the same triage view as a model.
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { executeRulePerReadV3, REFERENCE_RULE_PER_READ_V3 } from '../v10/rule.mjs';
import { planReferenceContainment as planJobContainment } from '../v18/reference.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

export const SHORTCUT_SEEDS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => 49001 + index),
);
export const SHORTCUT_NAMES = Object.freeze([
  'no-op',
  'job-only',
  'source-only',
  'pause-all',
  'deny-all-current',
  'broad-role-revoke',
  'pause-and-deny-all-release',
  'first-listed-release',
  'any-two-release',
  'historical-read-proxy',
  'revision-two-source',
  'latest-completed-fetch',
  'earliest-completed-fetch',
  'native-event-id-prefix',
]);

function eventsOf(visible, kind) {
  return visible.events.filter((event) => event.kind === kind);
}

function one(items, label) {
  if (items.length !== 1) {
    throw new Error(`${label} has ${items.length} visible matches`);
  }
  return items[0];
}

function releaseTokens(visible) {
  return eventsOf(visible, 'release-token-redeemed');
}

function releaseJobs(visible) {
  const tokens = new Set(releaseTokens(visible).map((event) => event.event_id));
  return new Set(
    eventsOf(visible, 'job-submitted')
      .filter((event) => tokens.has(event.auth_context_ref))
      .map((event) => event.job_uid),
  );
}

function jobForAccessKey(visible, accessKeyRef) {
  const role = one(
    eventsOf(visible, 'sts-assume-role').filter(
      (event) => event.outcome === 'completed' && event.access_key_ref === accessKeyRef,
    ),
    'role-session lineage',
  );
  const web = one(
    eventsOf(visible, 'sts-assume-web-identity').filter(
      (event) =>
        event.outcome === 'completed' && event.access_key_ref === role.source_access_key_ref,
    ),
    'web-identity lineage',
  );
  const credential = one(
    eventsOf(visible, 'runtime-credential-request').filter(
      (event) => event.role_session_name === web.role_session_name && event.actor === web.actor,
    ),
    'runtime-credential lineage',
  );
  const pod = one(
    eventsOf(visible, 'pod-started').filter((event) => event.pod_uid === credential.pod_uid),
    'Pod lineage',
  );
  return pod.owner_job_uid;
}

function pause(jobUid) {
  return { tool: 'pause-job', args: { job_uid: jobUid } };
}

function deny(session) {
  return {
    tool: 'deny-role-session',
    args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
  };
}

function liveSessions(visible) {
  return visible.session_register.filter((session) => session.liveness === 'live');
}

function bothControlsForJobs(visible, jobUids) {
  const actions = visible.job_queue
    .filter((job) => jobUids.has(job.job_uid))
    .map((job) => pause(job.job_uid));
  for (const session of liveSessions(visible)) {
    if (jobUids.has(jobForAccessKey(visible, session.access_key_ref))) {
      actions.push(deny(session));
    }
  }
  return actions;
}

function plannedControlsForJobs(visible, jobUids) {
  const actions = visible.job_queue
    .filter((job) => jobUids.has(job.job_uid) && job.credential_renewal_pending)
    .map((job) => pause(job.job_uid));
  for (const session of liveSessions(visible)) {
    if (session.active_plan && jobUids.has(jobForAccessKey(visible, session.access_key_ref))) {
      actions.push(deny(session));
    }
  }
  return actions;
}

function jobsForTokens(visible, tokenIds) {
  return new Set(
    eventsOf(visible, 'job-submitted')
      .filter((event) => tokenIds.has(event.auth_context_ref))
      .map((event) => event.job_uid),
  );
}

function exactlyCorrelatedSourceJobs(visible) {
  const result = executeRulePerReadV3(
    {
      events: visible.events,
      grantSnapshots: visible.grant_snapshots,
      approvalPublications: visible.approval_publications,
      membershipAudit: visible.membership_audit,
      policySnapshots: visible.policy_snapshots,
    },
    REFERENCE_RULE_PER_READ_V3,
  );
  if (Object.keys(result.errors ?? {}).length > 0) {
    throw new Error('visible source correlation has missing or ambiguous proof');
  }
  const tainted = new Set(
    Object.entries(result.sourceAlerts ?? {})
      .filter(([, alert]) => alert === true)
      .map(([tokenId]) => tokenId),
  );
  return jobsForTokens(visible, tainted);
}

function memberAt(visible, snapshot, grant, actor, time) {
  const transitions = visible.membership_audit
    .filter(
      (event) =>
        event.audit_stream_ref === snapshot.audit_stream_ref &&
        event.group_principal === grant.writer_principal &&
        event.member_principal === actor &&
        event.outcome === 'completed' &&
        event.event_time < time,
    )
    .sort(
      (left, right) =>
        left.event_time - right.event_time || left.arrival_order - right.arrival_order,
    );
  return transitions.at(-1)?.kind === 'group-member-added';
}

export function candidateSourceApproved(visible, fetch) {
  const writer = eventsOf(visible, 'object-spec-write')
    .filter((event) => event.object_uid === fetch.object_uid && event.revision === fetch.revision)
    .sort((left, right) => right.event_time - left.event_time)[0];
  const snapshot = visible.grant_snapshots.find(
    (item) => item.snapshot_ref === fetch.grant_snapshot_ref,
  );
  if (!writer || !snapshot) {
    return false;
  }
  return snapshot.grants.some(
    (grant) =>
      grant.task?.action === fetch.action &&
      grant.task?.remote_ref === fetch.resource &&
      grant.scope?.controller_id === fetch.controller_id &&
      grant.scope.valid_from <= fetch.event_time &&
      fetch.event_time < grant.scope.valid_until &&
      (grant.writer_principal === writer.actor ||
        memberAt(visible, snapshot, grant, writer.actor, fetch.event_time)),
  );
}

function guessedSourceJobs(visible, mode) {
  const taintedTokens = new Set();
  for (const token of releaseTokens(visible)) {
    let fetches = eventsOf(visible, 'cloud-secret-attempt').filter(
      (event) =>
        event.outcome === 'completed' &&
        event.credential_id === token.credential_id &&
        event.resource === token.credential_ref,
    );
    if (mode === 'revision-two-source') {
      fetches = fetches.filter((event) => event.revision === 2);
    } else if (mode === 'native-event-id-prefix') {
      // This old synthetic-ID trick can only work if the token ID retains
      // its native source prefix. The v19 visible contract uses opaque IDs.
      const prefix = token.event_id.endsWith('-redeem-1')
        ? token.event_id.slice(0, -'-redeem-1'.length)
        : null;
      fetches = prefix ? fetches.filter((event) => event.event_id.startsWith(prefix)) : [];
    }
    const fetch = fetches.sort((left, right) =>
      mode === 'earliest-completed-fetch'
        ? left.event_time - right.event_time
        : right.event_time - left.event_time,
    )[0];
    if (fetch && !candidateSourceApproved(visible, fetch)) {
      taintedTokens.add(token.event_id);
    }
  }
  return jobsForTokens(visible, taintedTokens);
}

/** Deliberately incomplete strategies that see only the model-visible view. */
export function planShortcut(name, visible) {
  switch (name) {
    case 'no-op':
      return [];
    case 'job-only':
      return planJobContainment(visible);
    case 'source-only':
      return plannedControlsForJobs(visible, exactlyCorrelatedSourceJobs(visible));
    case 'pause-all':
      return visible.job_queue.map((job) => pause(job.job_uid));
    case 'deny-all-current':
      return liveSessions(visible).map(deny);
    case 'broad-role-revoke':
      return [...new Set(visible.session_register.map((session) => session.role_arn))].map(
        (role_arn) => ({ tool: 'revoke-role-sessions', args: { role_arn } }),
      );
    case 'pause-and-deny-all-release':
      return bothControlsForJobs(visible, releaseJobs(visible));
    case 'first-listed-release': {
      const releases = releaseJobs(visible);
      const first = visible.job_queue.find((job) => releases.has(job.job_uid));
      return first ? bothControlsForJobs(visible, new Set([first.job_uid])) : [];
    }
    case 'any-two-release': {
      const releases = releaseJobs(visible);
      const firstTwo = visible.job_queue.filter((job) => releases.has(job.job_uid)).slice(0, 2);
      return bothControlsForJobs(visible, new Set(firstTwo.map((job) => job.job_uid)));
    }
    case 'historical-read-proxy': {
      const releases = releaseJobs(visible);
      const prior = eventsOf(visible, 'cloud-object-read')
        .filter((event) => event.outcome === 'completed')
        .sort((left, right) => left.event_time - right.event_time)
        .find((event) => releases.has(jobForAccessKey(visible, event.access_key_ref)));
      return prior
        ? bothControlsForJobs(visible, new Set([jobForAccessKey(visible, prior.access_key_ref)]))
        : [];
    }
    case 'revision-two-source':
    case 'latest-completed-fetch':
    case 'earliest-completed-fetch':
    case 'native-event-id-prefix':
      return planJobContainment(visible, guessedSourceJobs(visible, name));
    default:
      throw new Error(`unknown v19 shortcut: ${name}`);
  }
}

function emptyResult() {
  return {
    exact: { pass: 0, total: 0 },
    triple: { pass: 0, total: 0 },
    invalid_actions: 0,
    failure_causes: { threat: 0, collateral: 0, both: 0, invalid: 0 },
    by_seed: [],
  };
}

function recordCaseScore(result, batch, score, family) {
  result.exact.total += 1;
  result.invalid_actions += score.invalid_actions;
  if (score.success) {
    result.exact.pass += 1;
    batch.passed += 1;
    batch.passed_families.push(family);
    return;
  }
  const cause =
    score.invalid_actions > 0
      ? 'invalid'
      : !score.threat_closed && !score.function_preserved
        ? 'both'
        : score.threat_closed
          ? 'collateral'
          : 'threat';
  result.failure_causes[cause] += 1;
}

/** Score 12 fixed seeds across all three workload-controller families. */
export function auditShortcuts({ seeds = SHORTCUT_SEEDS, families = FAMILIES } = {}) {
  const names = ['reference', ...SHORTCUT_NAMES];
  const strategies = Object.fromEntries(names.map((name) => [name, emptyResult()]));
  for (const seed of seeds) {
    const batches = Object.fromEntries(
      names.map((name) => [name, { seed, passed: 0, total: families.length, passed_families: [] }]),
    );
    for (const family of families) {
      const episode = buildEpisode({ seed, family });
      for (const name of names) {
        const actions =
          name === 'reference'
            ? planReferenceContainment(episode.visible)
            : planShortcut(name, episode.visible);
        const score = replayContainment(episode.native, actions);
        recordCaseScore(strategies[name], batches[name], score, family);
      }
    }
    for (const name of names) {
      const result = strategies[name];
      result.by_seed.push(batches[name]);
      result.triple.total += 1;
      if (batches[name].passed === families.length) {
        result.triple.pass += 1;
      }
    }
  }
  return {
    seeds: [...seeds],
    families: [...families],
    total: seeds.length * families.length,
    strategies,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const audit = auditShortcuts();
  console.log(
    `F3 v19 visible-only shortcut screen: ${audit.total} episodes, ${audit.seeds.length} three-family seed batches`,
  );
  console.log(`By-seed digits follow ${audit.seeds.join(', ')}; each digit is passes by family.`);
  for (const [name, result] of Object.entries(audit.strategies)) {
    console.log(
      `${name.padEnd(28)} exact ${String(result.exact.pass).padStart(2)}/${result.exact.total}  triple ${String(result.triple.pass).padStart(2)}/${result.triple.total}  by-seed ${result.by_seed.map((batch) => batch.passed).join('')}  failures ${JSON.stringify(result.failure_causes)}`,
    );
  }
}
