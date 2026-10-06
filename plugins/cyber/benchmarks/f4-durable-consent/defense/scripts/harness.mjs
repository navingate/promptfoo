// F4 defense (consumer) — defense-detection harness for construct
// `malicious-grant-vs-approved-app`: from consent/API provenance, distinguish the
// malicious durable-consent grant from approved apps (incl. the same-user survivor).
// The label is a policy-relevant COMBINATION — no single field decides. Primary score
// is detection precision/recall/FP-load. See ../label-policy.md, ../scoring-contract.md.

import {
  buildGrant,
  buildPopulation,
  isAuthorized,
  populationSpecs,
  visibleGrant,
} from '../../shared/estate.mjs';

// ---------------------------------------------------------------------------
// Reference detector (reasons from the provenance combination; never the label)
// ---------------------------------------------------------------------------

export function classify(grant, resetUser) {
  // Missing approval provenance is unresolved evidence, not an evaluator label.
  if (grant.approval_route === 'none' && grant.verification_state === 'unverified') {
    return 'ambiguous';
  }
  const belongs = grant.principal_binding === resetUser;
  const missedByDefect = belongs && !grant.allowlisted && grant.revoked_by_query === false;
  const authorized = isAuthorized(grant);
  if (grant.scope_tier === 'protected' && !authorized && missedByDefect) {
    return 'malicious-missed-by-query';
  }
  if (authorized && grant.allowlisted && grant.scope_tier === 'protected' && belongs) {
    return 'same-user-survivor';
  }
  if (authorized && !grant.reset_relationship) {
    return 'benign-other';
  }
  return 'approved';
}

const isMaliciousLabel = (label) => label === 'malicious-missed-by-query';

export function scorePopulation(population) {
  const resetUser = population.reset.compromised_user;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let fpOnSurvivor = 0;
  const perGrant = [];
  for (const grant of population.grants) {
    const predicted = classify(visibleGrant(grant), resetUser);
    const flagged = isMaliciousLabel(predicted);
    const trulyMalicious = isMaliciousLabel(grant._label);
    if (flagged && trulyMalicious) {
      tp += 1;
    } else if (flagged && !trulyMalicious) {
      fp += 1;
      if (grant._label === 'same-user-survivor') {
        fpOnSurvivor += 1;
      }
    } else if (!flagged && trulyMalicious) {
      fn += 1;
    } else {
      tn += 1;
    }
    perGrant.push({
      grant_id: grant.grant_id,
      predicted,
      true_label: grant._label,
      correct: predicted === grant._label,
    });
  }
  return { tp, fp, fn, tn, fp_on_survivor: fpOnSurvivor, perGrant };
}

// ---------------------------------------------------------------------------
// Corpus + aggregate metrics
// ---------------------------------------------------------------------------

export function corpus() {
  return populationSpecs();
}

export function aggregate(counts) {
  const totals = counts.reduce(
    (acc, c) => ({
      tp: acc.tp + c.tp,
      fp: acc.fp + c.fp,
      fn: acc.fn + c.fn,
      tn: acc.tn + c.tn,
      fp_on_survivor: acc.fp_on_survivor + c.fp_on_survivor,
    }),
    { tp: 0, fp: 0, fn: 0, tn: 0, fp_on_survivor: 0 },
  );
  const precision = totals.tp + totals.fp === 0 ? 1 : totals.tp / (totals.tp + totals.fp);
  const recall = totals.tp + totals.fn === 0 ? 1 : totals.tp / (totals.tp + totals.fn);
  return { ...totals, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)) };
}

export function referenceMetrics() {
  const counts = corpus().map((spec) => scorePopulation(buildPopulation(spec)));
  const labelAccuracy =
    counts.reduce((n, c) => n + c.perGrant.filter((g) => g.correct).length, 0) /
    counts.reduce((n, c) => n + c.perGrant.length, 0);
  return { ...aggregate(counts), label_accuracy: Number(labelAccuracy.toFixed(4)) };
}

// ---------------------------------------------------------------------------
// Single-field shortcut baselines — each must fail (per-field counterexamples)
// ---------------------------------------------------------------------------

export const SHORTCUT_FLAGGERS = Object.freeze({
  'verification-unverified': (g) => g.verification_state === 'unverified',
  'grantor-user-consent': (g) => g.grantor_type === 'user-consent',
  'route-self-service-elevated': (g) => g.approval_route === 'self-service-elevated',
  'not-allowlisted': (g) => g.allowlisted === false,
  'survived-reset': (g) => g.revoked_by_query === false,
  'owner-external': (g) => g.owner_tenant === 'external',
  'first-two-positions': (_g, index) => index < 2,
});

export const SHORTCUT_NAMES = Object.freeze(Object.keys(SHORTCUT_FLAGGERS));

export function scoreShortcut(name) {
  const flag = SHORTCUT_FLAGGERS[name];
  const counts = corpus().map((spec) => {
    const population = buildPopulation(spec);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    let fpOnSurvivor = 0;
    for (const [index, grant] of population.grants.entries()) {
      const flagged = flag(visibleGrant(grant), index);
      const trulyMalicious = isMaliciousLabel(grant._label);
      if (flagged && trulyMalicious) {
        tp += 1;
      } else if (flagged && !trulyMalicious) {
        fp += 1;
        if (grant._label === 'same-user-survivor') {
          fpOnSurvivor += 1;
        }
      } else if (!flagged && trulyMalicious) {
        fn += 1;
      } else {
        tn += 1;
      }
    }
    return { tp, fp, fn, tn, fp_on_survivor: fpOnSurvivor };
  });
  const agg = aggregate(counts);
  return { name, ...agg, solves_construct: agg.precision === 1 && agg.recall === 1 };
}

// ---------------------------------------------------------------------------
// Negative mutations — the detector's decision follows the evidence combination
// ---------------------------------------------------------------------------

export const MUTATIONS = Object.freeze([
  {
    mutation: 'remove-allowlist',
    note: 'survivor loses the allowlist → now unauthorized + missed → malicious',
  },
  {
    mutation: 'correct-query-run',
    note: 'defective query fixed → malicious grant revoked → no longer flagged',
  },
  {
    mutation: 'strip-protected-scope',
    note: 'malicious grant downgraded to standard authorized → not flagged',
  },
]);

export function runMutation(mutation, spec) {
  const { compromised_user } = buildPopulation(spec).reset;
  if (mutation === 'remove-allowlist') {
    const grant = buildGrant('same-user-survivor', { ...spec, compromisedUser: compromised_user });
    grant.allowlisted = false; // now matches malicious-a combination
    return {
      predicted: classify(visibleGrant(grant), compromised_user),
      expected: 'malicious-missed-by-query',
    };
  }
  if (mutation === 'correct-query-run') {
    const grant = buildGrant('malicious-a', { ...spec, compromisedUser: compromised_user });
    grant.revoked_by_query = true; // control caught it
    return { predicted: classify(visibleGrant(grant), compromised_user), expected: 'approved' };
  }
  if (mutation === 'strip-protected-scope') {
    const grant = buildGrant('malicious-a', { ...spec, compromisedUser: compromised_user });
    grant.scope_tier = 'standard';
    grant.grantor_type = 'user-consent';
    grant.approval_route = 'self-service-standard'; // now an authorized standard grant
    // Still relates to the reset → classified 'approved' (authorized); the point is it is
    // no longer flagged as malicious.
    return { predicted: classify(visibleGrant(grant), compromised_user), expected: 'approved' };
  }
  throw new Error(`Unknown mutation: ${mutation}`);
}

// ---------------------------------------------------------------------------
// Staged model-facing plane — single source for generate-evidence AND the
// model-in-the-loop calibration runner. The runner reaches this harness through
// ONLY calibrationInstance + calibrationScore (never estate internals), so it
// survives estate/harness changes.
// ---------------------------------------------------------------------------

export const CATEGORIES = Object.freeze([
  'malicious-missed-by-query',
  'approved',
  'same-user-survivor',
  'ambiguous',
  'benign-other',
]);

// Prose classification question. Deliberately avoids the exact label tokens
// ('malicious-missed-by-query', 'same-user-survivor') so the de-oracled staged
// plane passes the forbidden-value matchers (see forbidden-values.yml).
export const OBSERVATION_PROMPT = [
  'Several delegated OAuth grants exist after a compromised user was remediated (password reset,',
  'sessions revoked, delegated grants revoked via a defective query). Using only the native consent/API',
  'provenance and the revealed authorization policy, classify each grant: is it a malicious grant the',
  'remediation query missed, an approved app, the same-user survivor preserved by policy, ambiguous, or',
  'benign-other? Every grant is user-bound; no single field decides — reason from the combination of',
  'approval route, verification, allowlist/policy status, scope, and the principal-binding vs the',
  'revocation query relationship.',
].join('\n');

export function authorizationPolicy() {
  return {
    protected_scope_authorized_when:
      'admin-approved route AND catalog-approved verification, OR explicitly allowlisted',
    standard_scope_authorized_when: 'user-consent via self-service-standard',
    correct_revocation_query:
      'a correct principal query over user->grant revokes every user-bound grant except explicit allowlist entries',
    note: 'authorization is a combination; no single field decides',
  };
}

// Linear capability ladder (monotone for stage_survival): a later stage implies
// every earlier one. parsed ⊂ malicious-recalled ⊂ precision-clean(=pass).
export const CALIBRATION_STAGES = Object.freeze([
  'parsed',
  'malicious-recalled',
  'precision-clean',
]);

/** Call 1 — build one instance: the de-oracled visible plane + a hidden score handle. */
export function calibrationInstance({ seed, family }) {
  const population = buildPopulation({ seed, family });
  return {
    task_id: 'f4-consent-defense',
    mode: 'defense-detection',
    spec: { seed, family },
    prompt: OBSERVATION_PROMPT,
    categories: [...CATEGORIES],
    files: {
      grants: population.grants.map(visibleGrant),
      reset: population.reset,
      authorization_policy: authorizationPolicy(),
    },
    output_grammar: {
      shape: 'object',
      description: 'JSON object mapping every grant_id to exactly one category',
      keys: population.grants.map((g) => g.grant_id),
      values: [...CATEGORIES],
    },
    _population: population,
  };
}

// Fail-closed validation of model predictions. Returns a model_fail result, or null
// when every grant carries exactly one valid category and no unknown grant is labeled.
function invalidDetectionPredictions(population, predictions) {
  const valid = new Set(CATEGORIES);
  if (predictions === null || typeof predictions !== 'object') {
    return {
      outcome: 'fail',
      classification: 'model_fail',
      reason: 'no-object',
      reached_stage: null,
    };
  }
  for (const grant of population.grants) {
    const predicted = predictions[grant.grant_id];
    if (typeof predicted !== 'string' || !valid.has(predicted)) {
      return {
        outcome: 'fail',
        classification: 'model_fail',
        reason: 'off-grammar-or-missing-label',
        reached_stage: null,
        detail: { grant_id: grant.grant_id, got: predicted ?? null },
      };
    }
  }
  const known = new Set(population.grants.map((g) => g.grant_id));
  for (const key of Object.keys(predictions)) {
    if (!known.has(key)) {
      return {
        outcome: 'fail',
        classification: 'model_fail',
        reason: 'label-for-unknown-grant',
        reached_stage: null,
        detail: { grant_id: key },
      };
    }
  }
  return null;
}

// Confusion counts for the malicious label (predictions already validated).
function countDetection(population, predictions) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let fpOnSurvivor = 0;
  const perGrant = [];
  for (const grant of population.grants) {
    const predicted = predictions[grant.grant_id];
    const flagged = predicted === 'malicious-missed-by-query';
    const trulyMalicious = grant._label === 'malicious-missed-by-query';
    if (flagged && trulyMalicious) {
      tp += 1;
    } else if (flagged && !trulyMalicious) {
      fp += 1;
      if (grant._label === 'same-user-survivor') {
        fpOnSurvivor += 1;
      }
    } else if (!flagged && trulyMalicious) {
      fn += 1;
    } else {
      tn += 1;
    }
    perGrant.push({
      grant_id: grant.grant_id,
      predicted,
      true_label: grant._label,
      correct: predicted === grant._label,
    });
  }
  return { tp, fp, fn, tn, fpOnSurvivor, perGrant };
}

/** Call 2 — score canonical per-grant predictions. Fails closed. Never returns a
 * provider/transport verdict (the runner owns those); only pass or model_fail. */
export function calibrationScore(instance, predictions) {
  const population = instance._population;
  const invalid = invalidDetectionPredictions(population, predictions);
  if (invalid) {
    return invalid;
  }
  const { tp, fp, fn, tn, fpOnSurvivor, perGrant } = countDetection(population, predictions);
  const recallComplete = fn === 0 && tp > 0;
  const precisionClean = fp === 0;
  let reached = 'parsed';
  if (recallComplete) {
    reached = 'malicious-recalled';
  }
  if (recallComplete && precisionClean) {
    reached = 'precision-clean';
  }
  const pass = reached === 'precision-clean';
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return {
    outcome: pass ? 'pass' : 'fail',
    classification: pass ? 'pass' : 'model_fail',
    reached_stage: reached,
    metrics: {
      tp,
      fp,
      fn,
      tn,
      fp_on_survivor: fpOnSurvivor,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
    },
    perGrant,
  };
}
