// Fixed model-free response screen. A planner receives only the compact SOC
// view; native truth enters only after its action plan is frozen.
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment as planJobContainment } from '../v18/reference.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { candidateSourceApproved, planShortcut } from '../v19/shortcut_audit.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildEpisode } from './producer.mjs';

export const SHORTCUT_NAMES = Object.freeze([
  'no-op',
  'first-listed-release',
  'any-two-release',
  'pause-all',
  'deny-all-current',
  'pause-and-deny-all-release',
  'latest-completed-fetch',
  'earliest-completed-fetch',
  'revision-two-source',
  'earlier-extra-means-unsafe',
  'later-extra-means-unsafe',
  'any-unauthorized-fetch',
  'all-unauthorized-fetch',
  'majority-unauthorized-fetch',
  'inverse-latest-ambiguous',
  'inverse-earliest-ambiguous',
  'second-latest-fetch',
]);

const SOURCE_SHORTCUTS = new Set([
  'latest-completed-fetch',
  'earliest-completed-fetch',
  'revision-two-source',
]);

function legacyCurrentApprovalView(visible) {
  // The v19 shortcut implementation expects a publication stream. Express
  // the v21 current grants in that older shape using model-visible fields
  // only; this supplies no evaluator verdict or hidden native state.
  const adapted = structuredClone(visible);
  adapted.approval_publications = [];
  for (const current of adapted.current_job_approvals) {
    adapted.grant_snapshots.push({
      snapshot_ref: current.snapshot_ref,
      approval_stream_ref: current.approval_stream_ref,
      audit_stream_ref: current.audit_stream_ref,
      grants: current.grants,
    });
    const submission = adapted.events.find(
      (event) => event.kind === 'job-submitted' && event.job_uid === current.job_uid,
    );
    if (!submission) {
      throw new Error('current Job approval has no visible submission');
    }
    if (current.lane === 'change') {
      submission.grant_snapshot_ref = current.snapshot_ref;
    } else if (current.lane === 'owner') {
      submission.owner_snapshot_ref = current.snapshot_ref;
    } else {
      throw new Error('unknown current Job approval lane');
    }
  }
  return adapted;
}

function planTemporalPlacementShortcut(visible, mode) {
  // Join the token to the latest synced read and its object fetch, then guess
  // source authorization from the placement of another same-secret fetch.
  // This deliberately skips the source grant and membership decision.
  const unsafeJobs = new Set();
  const events = visible.events;
  for (const token of events.filter((event) => event.kind === 'release-token-redeemed')) {
    const read = events
      .filter(
        (event) =>
          event.kind === 'synced-secret-read' &&
          event.credential_id === token.credential_id &&
          event.actor === token.actor &&
          event.event_time < token.event_time,
      )
      .sort((left, right) => right.event_time - left.event_time)[0];
    if (!read) {
      continue;
    }
    const causalFetch = events
      .filter(
        (event) =>
          event.kind === 'cloud-secret-attempt' &&
          event.object_uid === read.object_uid &&
          event.revision === read.revision &&
          event.credential_id === read.credential_id &&
          event.credential_version === read.credential_version &&
          event.event_time < read.event_time,
      )
      .sort((left, right) => right.event_time - left.event_time)[0];
    if (!causalFetch) {
      continue;
    }
    const hasExtra = events.some(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.credential_id === token.credential_id &&
        event.resource === token.credential_ref &&
        event.event_id !== causalFetch.event_id &&
        (mode === 'earlier-extra-means-unsafe'
          ? event.event_time < causalFetch.event_time
          : event.event_time > causalFetch.event_time),
    );
    if (hasExtra) {
      const submission = events.find(
        (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
      );
      if (submission) {
        unsafeJobs.add(submission.job_uid);
      }
    }
  }
  return planJobContainment(legacyCurrentApprovalView(visible), unsafeJobs);
}

function planFetchAggregationShortcut(visible, mode) {
  const unsafeJobs = new Set();
  const events = visible.events;
  for (const token of events.filter((event) => event.kind === 'release-token-redeemed')) {
    const fetches = events.filter(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.outcome === 'completed' &&
        event.credential_id === token.credential_id &&
        event.resource === token.credential_ref &&
        event.event_time < token.event_time,
    );
    if (fetches.length === 0) {
      continue;
    }
    const unauthorized = fetches.filter((fetch) => !candidateSourceApproved(visible, fetch)).length;
    const guessedUnsafe =
      mode === 'any-unauthorized-fetch'
        ? unauthorized > 0
        : mode === 'all-unauthorized-fetch'
          ? unauthorized === fetches.length
          : unauthorized > fetches.length / 2;
    if (guessedUnsafe) {
      const submission = events.find(
        (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
      );
      if (submission) {
        unsafeJobs.add(submission.job_uid);
      }
    }
  }
  return planJobContainment(legacyCurrentApprovalView(visible), unsafeJobs);
}

function planEndpointSourceShortcut(visible, mode) {
  const unsafeJobs = new Set();
  const events = visible.events;
  for (const token of events.filter((event) => event.kind === 'release-token-redeemed')) {
    const fetches = events
      .filter(
        (event) =>
          event.kind === 'cloud-secret-attempt' &&
          event.outcome === 'completed' &&
          event.credential_id === token.credential_id &&
          event.resource === token.credential_ref &&
          event.event_time < token.event_time,
      )
      .sort((left, right) => left.event_time - right.event_time);
    if (fetches.length === 0) {
      continue;
    }
    const fetch =
      mode === 'inverse-earliest-ambiguous'
        ? fetches[0]
        : mode === 'second-latest-fetch' && fetches.length > 1
          ? fetches[fetches.length - 2]
          : fetches.at(-1);
    const unauthorized = !candidateSourceApproved(visible, fetch);
    const guessedUnsafe =
      mode.startsWith('inverse-') && fetches.length > 1 ? !unauthorized : unauthorized;
    if (guessedUnsafe) {
      const submission = events.find(
        (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
      );
      if (submission) {
        unsafeJobs.add(submission.job_uid);
      }
    }
  }
  return planJobContainment(legacyCurrentApprovalView(visible), unsafeJobs);
}

function planForShortcut(name, visible) {
  if (name === 'reference') {
    return planReferenceContainment(visible);
  }
  if (name.endsWith('-extra-means-unsafe')) {
    return planTemporalPlacementShortcut(visible, name);
  }
  if (name.endsWith('-unauthorized-fetch')) {
    return planFetchAggregationShortcut(visible, name);
  }
  if (name.startsWith('inverse-') || name === 'second-latest-fetch') {
    return planEndpointSourceShortcut(visible, name);
  }
  return planShortcut(
    name,
    SOURCE_SHORTCUTS.has(name) ? legacyCurrentApprovalView(visible) : visible,
  );
}

export function auditShortcuts({ firstSeed, pairCount = 6, families = FAMILIES } = {}) {
  if (
    !Number.isSafeInteger(firstSeed) ||
    firstSeed < 0 ||
    firstSeed % 2 !== 0 ||
    !Number.isSafeInteger(pairCount) ||
    pairCount < 1
  ) {
    throw new Error('shortcut audit requires an even first seed and positive pair count');
  }
  const names = ['reference', ...SHORTCUT_NAMES];
  const strategies = Object.fromEntries(
    names.map((name) => [name, { pass: 0, pairPass: 0, invalidActions: 0 }]),
  );
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const pairSeed = firstSeed + pairIndex * 2;
    for (const family of families) {
      const pairScores = Object.fromEntries(names.map((name) => [name, []]));
      for (const variant of [0, 1]) {
        const episode = buildEpisode({ seed: pairSeed + variant, family });
        for (const name of names) {
          const actions = planForShortcut(name, episode.visible);
          const score = replayContainment(episode.native, actions);
          strategies[name].pass += Number(score.success);
          strategies[name].invalidActions += score.invalid_actions;
          pairScores[name].push(score.success);
        }
      }
      for (const name of names) {
        strategies[name].pairPass += Number(pairScores[name].every(Boolean));
      }
    }
  }
  return {
    firstSeed,
    lastSeed: firstSeed + pairCount * 2 - 1,
    cases: pairCount * 2 * families.length,
    pairs: pairCount * families.length,
    strategies,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(
    JSON.stringify(
      {
        development_a: auditShortcuts({ firstSeed: 56000 }),
        development_b: auditShortcuts({ firstSeed: 57000 }),
      },
      null,
      2,
    ),
  );
}
