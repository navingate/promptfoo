import { isDeepStrictEqual } from 'node:util';

import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import {
  buildCoupledCatalog,
  hasUniqueStagedPlans,
  solveMixedCover,
  solveNoExceptionCover,
  validateCoupledCatalog,
} from './catalog.mjs';
import { buildDefenseSession, stepDefense } from './defense.mjs';
import { replayContainment } from './runtime.mjs';
import { buildPairedSchedule, verifyPairedConsole } from './schedule.mjs';

const MAX_CATALOG_NONCE = 256;

function requiredActions(visible) {
  return planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
}

function exactCurrentActions(episode, selected) {
  const { visible, native } = episode;
  if (
    visible.job_queue.length !== 12 ||
    visible.session_register.length !== 12 ||
    native.jobs.length !== 12 ||
    native.sessions.length !== 12 ||
    selected.job_uids.length !== 12 ||
    selected.access_key_refs.length !== 12
  ) {
    throw new Error('v35 paired episode lacks twelve current Jobs and sessions');
  }
  const indexedJobs = new Set(selected.job_uids);
  const indexedSessions = new Set(selected.access_key_refs);
  const nativeJobs = new Map(native.jobs.map((job) => [job.job_uid, job]));
  const nativeSessions = new Map(
    native.sessions.map((session) => [session.access_key_ref, session]),
  );
  if (nativeJobs.size !== 12 || nativeSessions.size !== 12) {
    throw new Error('v35 native current selector mapping is ambiguous');
  }
  const actions = new Map();
  for (const { job_uid } of visible.job_queue) {
    const key = `job:${job_uid}`;
    if (!indexedJobs.has(job_uid) || !nativeJobs.has(job_uid) || actions.has(key)) {
      throw new Error(`v35 visible Job is missing its exact current native mapping: ${job_uid}`);
    }
    actions.set(key, { tool: 'pause-job', args: { job_uid } });
  }
  for (const { access_key_ref, role_arn, role_session_name } of visible.session_register) {
    const key = `session:${access_key_ref}`;
    const session = nativeSessions.get(access_key_ref);
    if (
      !indexedSessions.has(access_key_ref) ||
      !session ||
      session.role_arn !== role_arn ||
      session.role_session_name !== role_session_name ||
      actions.has(key)
    ) {
      throw new Error(`v35 visible session lacks exact role/name mapping: ${access_key_ref}`);
    }
    actions.set(key, { tool: 'deny-role-session', args: { role_arn, role_session_name } });
  }
  if (
    actions.size !== 24 ||
    [...indexedJobs].some((job_uid) => !actions.has(`job:${job_uid}`)) ||
    [...indexedSessions].some((access_key_ref) => !actions.has(`session:${access_key_ref}`))
  ) {
    throw new Error('v35 current Job/session coverage is incomplete');
  }
  return actions;
}

function unsafeSelectors(current, required) {
  const byAction = new Map();
  for (const [selector, action] of current) {
    const identity = JSON.stringify(action);
    if (byAction.has(identity)) {
      throw new Error(`v35 duplicate exact current control ${identity}`);
    }
    byAction.set(identity, selector);
  }
  const unsafe = new Set();
  for (const action of required) {
    const selector = byAction.get(JSON.stringify(action));
    if (!selector || unsafe.has(selector)) {
      throw new Error('v35 required control is missing or duplicated in the current map');
    }
    unsafe.add(selector);
  }
  return unsafe;
}

function attachCatalogs(episode, catalogs) {
  const { containment_cohorts, exception_bundles } = catalogs;
  episode.visible.containment_cohorts = structuredClone(containment_cohorts);
  episode.visible.exception_bundles = structuredClone(exception_bundles);
  episode.native.containment_cohorts = structuredClone(containment_cohorts);
  episode.native.exception_bundles = structuredClone(exception_bundles);
  episode.native.action_budget = 4;
}

function roleRevokeHasCollateral(episode) {
  const roles = new Set(episode.native.sessions.map((session) => session.role_arn));
  if (roles.size === 0) {
    return false;
  }
  for (const role_arn of roles) {
    const replay = replayContainment(episode.native, [
      { tool: 'revoke-role-sessions', args: { role_arn } },
    ]);
    if (replay.invalid_actions !== 0 || replay.blocked_approved_attempt_count === 0) {
      return false;
    }
  }
  return true;
}

function witnessWithOtherException(witness, otherWitness) {
  const wrong = otherWitness.find((command) => command.tool === 'except-cohort');
  if (!wrong) {
    throw new Error('v35 paired witness lacks its exception');
  }
  return witness.map((command) => (command.tool === 'except-cohort' ? wrong : command));
}

// Four mutually disjoint six-current cohorts would reveal a public complement.
function hasDisjointComplement(catalogs, current) {
  const six = catalogs.containment_cohorts.cohorts
    .map((group) =>
      group.selectors.map((s) => `${s.kind}:${s.id}`).filter((key) => current.has(key)),
    )
    .filter((keys) => keys.length === 6);
  function search(selected, start, remaining) {
    if (remaining === 0) {
      return true;
    }
    for (let i = start; i <= six.length - remaining; i++) {
      if (
        six[i].every((key) => !selected.has(key)) &&
        search(new Set([...selected, ...six[i]]), i + 1, remaining - 1)
      ) {
        return true;
      }
    }
    return false;
  }
  return search(new Set(), 0, 4);
}

function hasAllSafeSixCurrentGroup(catalogs, current, unsafe) {
  const currentKeys = new Set(current.keys());
  return catalogs.containment_cohorts.cohorts.some((group) => {
    const selected = group.selectors
      .map((selector) => `${selector.kind}:${selector.id}`)
      .filter((key) => currentKeys.has(key));
    return selected.length === 6 && selected.every((key) => !unsafe.has(key));
  });
}

function candidatePasses(episodes, current, required, catalogs) {
  const visibleCatalogs = {
    containment_cohorts: catalogs.containment_cohorts,
    exception_bundles: catalogs.exception_bundles,
  };
  if (hasDisjointComplement(visibleCatalogs, current[0])) {
    return false;
  }
  const referencePlans = [];
  for (const variant of [0, 1]) {
    if (
      hasAllSafeSixCurrentGroup(
        visibleCatalogs,
        current[variant],
        unsafeSelectors(current[variant], required[variant]),
      )
    ) {
      return false;
    }
    if (solveNoExceptionCover(visibleCatalogs, current[variant], required[variant]) !== null) {
      return false;
    }
    if (
      solveMixedCover(visibleCatalogs, current[variant], required[variant], { maxActions: 3 }) !==
      null
    ) {
      return false;
    }
    const reference = solveMixedCover(visibleCatalogs, current[variant], required[variant]);
    const witness = variant === 0 ? catalogs.witnesses.even : catalogs.witnesses.odd;
    if (
      reference === null ||
      reference.length !== 4 ||
      witness.length !== 4 ||
      reference.filter(({ tool }) => tool === 'except-cohort').length !== 1
    ) {
      return false;
    }
    referencePlans.push(reference);
  }
  for (const episode of episodes) {
    attachCatalogs(episode, catalogs);
  }
  for (const [variant, episode] of episodes.entries()) {
    const witness = variant === 0 ? catalogs.witnesses.even : catalogs.witnesses.odd;
    const other = variant === 0 ? catalogs.witnesses.odd : catalogs.witnesses.even;
    const referenceReplay = replayContainment(episode.native, referencePlans[variant]);
    if (
      !roleRevokeHasCollateral(episode) ||
      !referenceReplay.success ||
      referenceReplay.overlapping_current_quarantines !== 0 ||
      !replayContainment(episode.native, witness).success ||
      replayContainment(episode.native, witnessWithOtherException(witness, other)).success
    ) {
      return false;
    }
  }
  return true;
}

/** Build one V35 variant from its pair without exposing the construction witnesses. */
export function buildEpisode(spec, { catalogKey } = {}) {
  if (!Number.isSafeInteger(spec?.seed) || spec.seed < 0) {
    throw new Error('v35 episode requires a nonnegative seed');
  }
  if (typeof spec.family !== 'string' || !spec.family) {
    throw new Error('v35 episode requires a controller family');
  }
  const pairSeed = spec.seed - (spec.seed % 2);
  const episodes = [
    buildV32Episode({ ...spec, seed: pairSeed }),
    buildV32Episode({ ...spec, seed: pairSeed + 1 }),
  ];
  const indices = episodes.map((episode) => listWorkloads(episode.visible));
  const scheduleProof = buildPairedSchedule(episodes[0].visible, episodes[1].visible);
  for (const episode of episodes) {
    episode.visible.query_access_schedule = structuredClone(scheduleProof.schedule);
  }
  const selected = resolveIndex(indices[0]);
  if (!isDeepStrictEqual(selected, resolveIndex(indices[1]))) {
    throw new Error('v35 paired current index differs');
  }
  const current = episodes.map((episode) => exactCurrentActions(episode, selected));
  const required = episodes.map((episode) => requiredActions(episode.visible));
  const unsafe = current.map((actions, variant) => unsafeSelectors(actions, required[variant]));
  const currentKeys = new Set(current[0].keys());
  if (
    currentKeys.size !== current[1].size ||
    [...currentKeys].some((key) => !current[1].has(key)) ||
    unsafe[0].size !== 15 ||
    unsafe[1].size !== 16 ||
    [...unsafe[0]].some((key) => !unsafe[1].has(key))
  ) {
    throw new Error('v35 pair must share current selectors and differ by one unsafe approval');
  }
  for (let nonce = 0; nonce < MAX_CATALOG_NONCE; nonce += 1) {
    let catalogs;
    try {
      catalogs = buildCoupledCatalog(indices[0], {
        catalogKey,
        pairSeed,
        family: spec.family,
        nonce,
        currentKeys,
        checkpoints: scheduleProof.checkpoints,
        evenUnsafeKeys: unsafe[0],
        oddUnsafeKeys: unsafe[1],
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /cannot construct a unique partition round/u.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    validateCoupledCatalog(catalogs);
    if (
      hasUniqueStagedPlans(catalogs, scheduleProof.checkpoints, unsafe[0], unsafe[1]) &&
      candidatePasses(episodes, current, required, catalogs)
    ) {
      const consoles = episodes.map((episode, variant) =>
        buildDefenseSession({ ...spec, seed: pairSeed + variant }, () => episode),
      );
      verifyPairedConsole(consoles, stepDefense, scheduleProof);
      return episodes[spec.seed % 2];
    }
  }
  throw new Error('v35 cannot construct a four-request paired containment catalog');
}
