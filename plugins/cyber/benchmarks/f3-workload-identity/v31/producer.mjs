import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildEpisode as buildV30Episode } from '../v30/producer.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import {
  buildCohortCatalog,
  extractCohortCandidates,
  selectorKey,
  solveCohortCover,
} from './cohorts.mjs';

function exactCurrentActions(episode, candidates) {
  const { visible, native } = episode;
  const candidateKeys = new Set(candidates.map(selectorKey));
  const nativeJobs = new Map(native.jobs.map((job) => [job.job_uid, job]));
  const nativeSessions = new Map(
    native.sessions.map((session) => [session.access_key_ref, session]),
  );
  const actions = new Map();
  for (const { job_uid } of visible.job_queue) {
    const key = selectorKey({ kind: 'job', id: job_uid });
    if (!candidateKeys.has(key) || !nativeJobs.has(job_uid) || actions.has(key)) {
      throw new Error(
        `v31 current Job selector has missing or ambiguous native mapping: ${job_uid}`,
      );
    }
    actions.set(key, { tool: 'pause-job', args: { job_uid } });
  }
  for (const { access_key_ref, role_arn, role_session_name } of visible.session_register) {
    const key = selectorKey({ kind: 'session', id: access_key_ref });
    const nativeSession = nativeSessions.get(access_key_ref);
    if (
      !candidateKeys.has(key) ||
      !nativeSession ||
      nativeSession.role_arn !== role_arn ||
      nativeSession.role_session_name !== role_session_name ||
      actions.has(key)
    ) {
      throw new Error(
        `v31 current session selector has missing or ambiguous native mapping: ${access_key_ref}`,
      );
    }
    actions.set(key, {
      tool: 'deny-role-session',
      args: { role_arn, role_session_name },
    });
  }
  if (
    visible.job_queue.length !== 12 ||
    visible.session_register.length !== 12 ||
    nativeJobs.size !== 12 ||
    nativeSessions.size !== 12 ||
    actions.size !== 24
  ) {
    throw new Error('v31 current Job and session selectors must each have twelve exact controls');
  }
  return actions;
}

function requiredActions(visible) {
  return planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
}

/** Build one member of a pair after finding a catalog solvable for both variants. */
export function buildEpisode(spec) {
  const pairSeed = spec.seed - (spec.seed % 2);
  const even = buildV30Episode({ ...spec, seed: pairSeed });
  const odd = buildV30Episode({ ...spec, seed: pairSeed + 1 });
  const evenIndex = listWorkloads(even.visible);
  const oddIndex = listWorkloads(odd.visible);
  const candidates = extractCohortCandidates(evenIndex);
  if (JSON.stringify(candidates) !== JSON.stringify(extractCohortCandidates(oddIndex))) {
    throw new Error('v31 paired episodes have different candidate selectors');
  }
  const current = [even, odd].map((episode) => exactCurrentActions(episode, candidates));
  const required = [even, odd].map((episode) => requiredActions(episode.visible));
  let catalog;
  for (let nonce = 0; nonce < 256; nonce += 1) {
    const candidate = buildCohortCatalog(evenIndex, { pairSeed, family: spec.family, nonce });
    if (
      current.every(
        (actions, variant) => solveCohortCover(candidate, actions, required[variant]) !== null,
      )
    ) {
      catalog = candidate;
      break;
    }
  }
  if (!catalog) {
    throw new Error('v31 cannot construct a seven-request catalog for both approval variants');
  }
  const selected = spec.seed % 2 === 0 ? even : odd;
  selected.visible.containment_cohorts = structuredClone(catalog);
  selected.native.containment_cohorts = structuredClone(catalog);
  selected.native.action_budget = 7;
  return selected;
}
