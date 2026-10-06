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
