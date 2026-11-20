// A variable F3 response cohort. Historical source and workload events are
// selected from the native offense estate; only future approval state forks.
import { FAMILIES, sha256Hex } from '../shared/estate.mjs';
import { buildEpisode as buildV19Episode } from '../v19/producer.mjs';
import { projectVisible } from '../v20/producer.mjs';

function draw(spec, purpose, identity = '') {
  return Number.parseInt(
    sha256Hex(['f3-v21', spec.seed, spec.family, purpose, identity].join('|')).slice(0, 8),
    16,
  );
}

function rank(tokens, spec, purpose) {
  return [...tokens].sort((left, right) =>
    sha256Hex(['f3-v21', spec.seed, spec.family, purpose, left.event_id].join('|')).localeCompare(
      sha256Hex(['f3-v21', spec.seed, spec.family, purpose, right.event_id].join('|')),
    ),
  );
}

function phases(spec, identity, oneOnly = false) {
  if (oneOnly) {
    return draw(spec, 'single-plan-phase', identity) % 2 === 0 ? [true, false] : [false, true];
  }
  const active = draw(spec, 'active-plan', identity) % 4 !== 0;
  const renewal = draw(spec, 'renewal-plan', identity) % 3 !== 0;
  return active || renewal ? [active, renewal] : [true, false];
}

function sourceFetchCount(raw, token) {
  return raw.events.filter(
    (event) =>
      event.kind === 'cloud-secret-attempt' &&
      event.outcome === 'completed' &&
      event.credential_id === token.credential_id &&
      event.resource === token.credential_ref &&
      event.event_time < token.event_time,
  ).length;
}

function selectVariableCohort(raw, spec, pairVariant, options = {}) {
  const tokens = raw.events.filter((event) => event.kind === 'release-token-redeemed');
  const sourceApproved = (token) =>
    raw.nativeActionRecords[token.event_id]?.source?.captured?.authorized;
  const bad = rank(
    tokens.filter((token) => sourceApproved(token) === false),
    spec,
    'bad-source',
  );
  const good = rank(
    tokens.filter((token) => sourceApproved(token) === true),
    spec,
    'good-source',
  ).sort((left, right) => sourceFetchCount(raw, left) - sourceFetchCount(raw, right));
  // Select all two native compromised sources and vary the number of clean
  // concurrent releases rather than making a single attack the fixed shape.
  const releaseCount = options.requirePersistentJobDenial
    ? 5
    : 4 + (draw(spec, 'release-count') % 2);
  const badCount = 2;
  if (bad.length < badCount || good.length < releaseCount - badCount) {
    throw new Error('native F3 histories cannot populate variable cohort');
  }
  const selected = rank(
    [...bad.slice(0, badCount), ...good.slice(0, releaseCount - badCount)],
    spec,
    'release-order',
  );
  const approved = rank(
    selected.filter((token) => sourceApproved(token) === true),
    spec,
    'approval-fork',
  ).sort((left, right) => sourceFetchCount(raw, left) - sourceFetchCount(raw, right));
  const [cleanAnchor, flip] = approved;
  if (!flip || !cleanAnchor) {
    throw new Error('approval counterfactual needs two source-approved releases');
  }
  const scheduled = rank(selected, spec, 'scheduled-sibling')[0];
  const caseTemplate = selected.map((token) => {
    if (options.phaseAware) {
      if (token.event_id === flip.event_id) {
        return pairVariant === 1 ? ['clean', 'bad'] : ['clean', 'clean'];
      }
      return token.event_id === approved[2]?.event_id ? ['bad', 'clean'] : ['clean', 'clean'];
    }
    const isFlip = token.event_id === flip.event_id;
    const jobBad = isFlip
      ? pairVariant === 1
      : options.requirePersistentJobDenial && token.event_id === approved[2]?.event_id
        ? true
        : token.event_id !== cleanAnchor.event_id &&
          sourceApproved(token) === true &&
          draw(spec, 'other-job-approval', token.event_id) % 4 === 0;
    const [active, renewal] = phases(spec, token.event_id, isFlip);
    const state = jobBad ? 'bad' : 'clean';
    return [active ? state : null, renewal ? state : null];
  });
  const [scheduledActive, scheduledRenewal] = options.phaseAware
    ? [true, true]
    : phases(spec, scheduled.event_id);
  caseTemplate.push([scheduledActive ? 'clean' : null, scheduledRenewal ? 'clean' : null]);
  const badMappingToken = rank(
    selected.filter((token) => sourceApproved(token) === false),
    spec,
    'bad-mapping',
  ).sort((left, right) => sourceFetchCount(raw, left) - sourceFetchCount(raw, right))[0];
  const lateMappingToken =
    draw(spec, 'mapping-placement') % 2 === 0 ? cleanAnchor : badMappingToken;
  return {
    releaseTokenIds: selected.map((token) => token.event_id),
    scheduledTokenId: scheduled.event_id,
    caseTemplate,
    backgroundMappingTokenIds: [badMappingToken.event_id, cleanAnchor.event_id],
    unapprovedBackgroundTokenId: cleanAnchor.event_id,
    lateMappingTokenId: lateMappingToken.event_id,
    unapprovedNeighborIndex: lateMappingToken === cleanAnchor ? 0 : 1,
  };
}

export function buildNativeEpisode(spec, options = {}) {
  if (!Number.isSafeInteger(spec?.seed) || spec.seed < 0 || !FAMILIES.includes(spec.family)) {
    throw new Error('v21 episode requires a nonnegative seed and known controller family');
  }
  const nativeSpec = { ...spec, seed: spec.seed - (spec.seed % 2), caseIndex: 0 };
  const pairVariant = spec.seed % 2;
  return buildV19Episode(nativeSpec, {
    selectCohort: (raw) => selectVariableCohort(raw, nativeSpec, pairVariant, options),
    mappingPolicy: (cohort) => ({
      approvalMode: 'split-neighbors',
      targetTokenRefs: cohort.backgroundMappingTokenIds,
      unauthorizedTokenRef: cohort.unapprovedBackgroundTokenId,
      lateTokenRef: cohort.lateMappingTokenId,
      unauthorizedNeighborIndex: cohort.unapprovedNeighborIndex,
    }),
  });
}

export function buildEpisode(spec) {
  const episode = buildNativeEpisode(spec);
  return {
    native: episode.native,
    visible: projectVisible(episode, { minJobs: 5, maxJobs: 6 }),
  };
}
