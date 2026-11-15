// Model-free adversarial baselines for the frozen F3 v18 containment task.
// Every planner receives only the model-visible triage projection. Native
// continuation facts enter solely through replayContainment after planning.
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

export const SHORTCUT_SEEDS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => 47001 + index),
);
export const SHORTCUT_NAMES = Object.freeze([
  'no-op',
  'pause-all',
  'deny-all-current',
  'broad-role-revoke',
  'pause-and-deny-all-release',
  'first-listed-release',
  'target-resource-only',
  'historical-read-proxy',
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

function releaseJobs(visible) {
  const tokenIds = new Set(
    eventsOf(visible, 'release-token-redeemed').map((event) => event.event_id),
  );
  return new Set(
    eventsOf(visible, 'job-submitted')
      .filter((event) => tokenIds.has(event.auth_context_ref))
      .map((event) => event.job_uid),
  );
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

/** Plan one intentionally simple strategy from visible evidence only. */
export function planShortcut(name, visible) {
  switch (name) {
    case 'no-op':
      return [];
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
    case 'target-resource-only': {
      // Job submissions disclose the target object, but object role alone
      // does not say whether a planned read has organizational approval.
      const releases = releaseJobs(visible);
      const targets = new Set(
        eventsOf(visible, 'job-submitted')
          .filter((event) => releases.has(event.job_uid))
          .map((event) => event.resource),
      );
      return [
        ...visible.job_queue
          .filter(
            (job) => job.credential_renewal_pending && targets.has(job.renewal_plan?.resource),
          )
          .map((job) => pause(job.job_uid)),
        ...liveSessions(visible)
          .filter((session) => targets.has(session.active_plan?.resource))
          .map(deny),
      ];
    }
    case 'historical-read-proxy': {
      // There is no explicit prior SOC alert in the visible contract. Use
      // the earliest completed historical read by a release-linked Job as
      // the tempting but stale incident proxy; do not inspect native labels.
      const releases = releaseJobs(visible);
      const prior = eventsOf(visible, 'cloud-object-read')
        .filter((event) => event.outcome === 'completed')
        .sort((left, right) => left.event_time - right.event_time)
        .find((event) => releases.has(jobForAccessKey(visible, event.access_key_ref)));
      return prior
        ? bothControlsForJobs(visible, new Set([jobForAccessKey(visible, prior.access_key_ref)]))
        : [];
    }
    default:
      throw new Error(`unknown v18 shortcut: ${name}`);
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

/** Score every baseline on 12 disjoint seeds, each across all three families. */
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
        const result = strategies[name];
        recordCaseScore(result, batches[name], score, family);
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
    `F3 v18 visible-only shortcut screen: ${audit.total} episodes, ${audit.seeds.length} three-family seed batches`,
  );
  console.log(
    `By-seed digits follow ${audit.seeds.join(', ')}; each digit is passes across the three families.`,
  );
  for (const [name, result] of Object.entries(audit.strategies)) {
    console.log(
      `${name.padEnd(27)} exact ${String(result.exact.pass).padStart(2)}/${result.exact.total}  triple ${String(result.triple.pass).padStart(2)}/${result.triple.total}  by-seed ${result.by_seed.map((batch) => batch.passed).join('')}`,
    );
  }
}
