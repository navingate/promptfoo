// F4 v3 defense (consumer) — malicious-grant-vs-approved-app. The detector classifies each grant
// from the model-visible plane (raw grant facts + authorization/preservation registry + revealed
// base policy + remediation runbook) by the deterministic JOIN in defense/label-policy.md, scored
// against the evaluator-only key. Precision / recall / FP-load on `malicious-missed-by-query`.
//
// The REFERENCE JOINER below is an INDEPENDENT re-implementation of the join + label procedure that
// reads ONLY the visible plane — it never calls the estate's authorizedByJoin/labelFor, so
// "reproduces the key exactly" is a real check, not a tautology (advisor 2026-10-08).

import {
  buildInstance,
  CORPUS_SEEDS,
  FAMILIES,
  LABELS,
  labelFor,
  populationSpecs,
  visibleBasePolicy,
  visibleGrant,
  visibleRegistry,
  visibleRemediation,
} from '../../shared/estate.mjs';

// ---------------------------------------------------------------------------
// Reference joiner (independent; reads only the visible plane)
// ---------------------------------------------------------------------------

// Fields a published base rule or registry selector reads (completeness check → ambiguous).
const REFERENCED_FIELDS = Object.freeze([
  'client_id',
  'tenant',
  'principal_binding',
  'scopes',
  'approval_route',
  'grantor_type',
  'verification_state',
]);

function selectorMatches(selector, value) {
  if (selector === undefined || selector === null) {
    return false;
  }
  if (selector === '*') {
    return true;
  }
  if (Array.isArray(selector)) {
    return Array.isArray(value)
      ? value.every((v) => selector.includes(v))
      : selector.includes(value);
  }
  return Array.isArray(value) ? value.every((v) => v === selector) : selector === value;
}

function entryCovers(entry, grant) {
  return (
    selectorMatches(entry.client_or_app_selector, grant.client_id) &&
    selectorMatches(entry.tenant_selector, grant.tenant) &&
    selectorMatches(entry.principal_selector, grant.principal_binding) &&
    selectorMatches(entry.scope_selector, grant.scopes) &&
    selectorMatches(entry.approval_route_selector, grant.approval_route)
  );
}

function entryValidAt(entry, t) {
  if (entry.valid_from !== undefined && entry.valid_from !== null && entry.valid_from > t) {
    return false;
  }
  if (entry.valid_until !== undefined && entry.valid_until !== null && entry.valid_until < t) {
    return false;
  }
  if (entry.revoked_at !== undefined && entry.revoked_at !== null && entry.revoked_at <= t) {
    return false;
  }
  return true;
}

function baseAuthorizes(grant, basePolicy) {
  return basePolicy.rules.some(
    (r) =>
      grant.grantor_type === r.grantor_type &&
      grant.approval_route === r.approval_route &&
      grant.verification_state === r.verification_state &&
      (!r.scopes_within_catalog ||
        (grant.scopes ?? []).every((s) => (grant.catalog_scopes ?? []).includes(s))),
  );
}

function isAmbiguousVisible(grant) {
  if (REFERENCED_FIELDS.some((k) => grant[k] === undefined || grant[k] === null)) {
    return true;
  }
  if (
    grant.call_time !== undefined &&
    grant.call_time !== null &&
    grant.issue_time > grant.call_time
  ) {
    return true;
  }
  return false;
}

/** The reference joiner: deterministic label from the visible plane alone (label-policy.md order). */
export function classifyGrant(grant, registry, basePolicy, remediation) {
  if (isAmbiguousVisible(grant)) {
    return 'ambiguous';
  }
  const authorized =
    baseAuthorizes(grant, basePolicy) ||
    registry.some((e) => entryCovers(e, grant) && entryValidAt(e, grant.issue_time));
  const inRevoked = remediation.revoked_grant_ids.includes(grant.grant_id);
  const didSurvive = grant.accessed_post_reset === true && !inRevoked;
  if (!authorized) {
    if (didSurvive) {
      return 'malicious-missed-by-query';
    }
    if (inRevoked) {
      return 'unauthorized-revoked';
    }
    return 'benign-other';
  }
  if (grant.principal_binding === remediation.compromised_user && grant.accessed_post_reset) {
    return 'same-user-survivor';
  }
  return 'approved';
}

/** Project an instance to the model-visible plane (what the detector / staged files carry). */
export function visiblePlane(instance) {
  return {
    grants: instance.grants.map(visibleGrant),
    registry: visibleRegistry(instance.registry),
    base_policy: visibleBasePolicy(),
    remediation: visibleRemediation(instance.remediation),
  };
}

/** The reference detector: classify every grant from the visible plane. Returns {grant_id: label}. */
export function referenceDetect(instance) {
  const plane = visiblePlane(instance);
  const out = {};
  for (const g of plane.grants) {
    out[g.grant_id] = classifyGrant(g, plane.registry, plane.base_policy, plane.remediation);
  }
  return out;
}

/** The evaluator key for an instance (uses the estate's labelFor — the authoritative label). */
export function evaluatorKey(instance) {
  const key = {};
  for (const g of instance.grants) {
    key[g.grant_id] = labelFor(g, instance.registry, instance.remediation);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Detection scoring (precision / recall / FP-load on malicious-missed-by-query)
// ---------------------------------------------------------------------------

const TARGET = 'malicious-missed-by-query';

export function scoreDetection(instance, predictions) {
  const key = evaluatorKey(instance);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let fpOnSurvivor = 0;
  let fpOnApproved = 0;
  for (const g of instance.grants) {
    const truth = key[g.grant_id];
    const pred = predictions[g.grant_id];
    if (truth === TARGET && pred === TARGET) {
      tp += 1;
    } else if (truth !== TARGET && pred === TARGET) {
      fp += 1;
      if (truth === 'same-user-survivor') {
        fpOnSurvivor += 1;
      }
      if (truth === 'approved' || truth === 'benign-other') {
        fpOnApproved += 1;
      }
    } else if (truth === TARGET && pred !== TARGET) {
      fn += 1;
    }
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  // "useful detection" = caught every live malicious grant with no false positive on a clear app.
  const pass = recall === 1 && fpOnSurvivor === 0 && fpOnApproved === 0;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    fp_on_survivor: fpOnSurvivor,
    fp_on_approved: fpOnApproved,
    pass,
  };
}

/** Reference detection score: the reference joiner must reproduce the key exactly (pass). */
export function referenceScore(spec) {
  const instance = buildInstance(spec);
  const predictions = referenceDetect(instance);
  const exact = instance.grants.every(
    (g) => predictions[g.grant_id] === evaluatorKey(instance)[g.grant_id],
  );
  return { ...scoreDetection(instance, predictions), exact_key_match: exact };
}

// ---------------------------------------------------------------------------
// Shortcuts to defeat (feeds G3): each cheap classifier must NOT reproduce the key
// ---------------------------------------------------------------------------

export const SHORTCUT_NAMES = Object.freeze([
  'survived-reset-is-malicious',
  'creation-lineage-plus-survival',
  'entry-names-client',
  'single-field',
  'grant-type-or-ownership',
]);

function shortcutPredict(name, plane) {
  const predict = {};
  for (const g of plane.grants) {
    let label = 'approved';
    if (name === 'survived-reset-is-malicious') {
      label = g.accessed_post_reset ? TARGET : 'approved';
    } else if (name === 'creation-lineage-plus-survival') {
      label =
        g.accessed_post_reset && typeof g.created_via_session_ref === 'string'
          ? TARGET
          : 'approved';
    } else if (name === 'entry-names-client') {
      // "an entry names this client" ⇒ authorized (ignores validity / full coverage)
      const named = plane.registry.some((e) => e.client_or_app_selector === g.client_id);
      label = named ? 'approved' : TARGET;
    } else if (name === 'single-field') {
      // key on verification_state alone
      label = g.verification_state === 'unverified' ? TARGET : 'approved';
    } else if (name === 'grant-type-or-ownership') {
      label = g.tenant === 'external' ? TARGET : 'approved';
    }
    predict[g.grant_id] = label;
  }
  return predict;
}

export function runShortcut(name, corpus) {
  let exactInstances = 0;
  let targetCorrect = 0;
  let targetTotal = 0;
  let fpTotal = 0;
  for (const spec of corpus) {
    const instance = buildInstance(spec);
    const plane = visiblePlane(instance);
    const key = evaluatorKey(instance);
    const pred = shortcutPredict(name, plane);
    let exact = true;
    for (const g of instance.grants) {
      const truth = key[g.grant_id];
      if (pred[g.grant_id] !== truth) {
        exact = false;
      }
      if (truth === TARGET) {
        targetTotal += 1;
        if (pred[g.grant_id] === TARGET) {
          targetCorrect += 1;
        }
      } else if (pred[g.grant_id] === TARGET) {
        fpTotal += 1;
      }
    }
    if (exact) {
      exactInstances += 1;
    }
  }
  return {
    name,
    exact_instances: exactInstances,
    instances: corpus.length,
    target_recall: targetTotal ? Number((targetCorrect / targetTotal).toFixed(3)) : 0,
    false_positives: fpTotal,
    solves_construct: exactInstances === corpus.length,
  };
}

// ---------------------------------------------------------------------------
// Counterexample coverage (every class + the 7 counterexamples + 4 distractors present)
// ---------------------------------------------------------------------------

export function coverageReport() {
  const classes = new Set();
  const ces = new Set();
  const distractors = new Set();
  for (const spec of populationSpecs()) {
    const instance = buildInstance(spec);
    for (const g of instance.grants) {
      classes.add(labelFor(g, instance.registry, instance.remediation));
      if (g._ce) {
        ces.add(g._ce);
      }
      if (g._distractor) {
        distractors.add(g._distractor);
      }
    }
  }
  return {
    classes: [...classes].sort(),
    all_classes: LABELS.every((l) => classes.has(l)),
    counterexamples: [...ces].sort((a, b) => a - b),
    all_counterexamples: [1, 2, 3, 4, 5, 6, 7, 8, 9].every((c) => ces.has(c)),
    distractors: [...distractors].sort(),
    all_distractors: distractors.size === 4,
  };
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

export function defenseCorpus() {
  const corpus = [];
  for (const family of FAMILIES) {
    for (const seed of CORPUS_SEEDS) {
      corpus.push({ seed, family });
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// Two-call calibration interface (defense-detection). The model classifies each grant from the
// visible plane; calibrationScore compares to the evaluator key and reports the detection metric.
// ---------------------------------------------------------------------------

// Stage ladder (monotone): parsed → malicious-recalled (every malicious grant caught) →
// precision-clean (also no false positive on an authorized app). The runner's defense-detection
// path renders `prompt` + `categories` + `files.{reset,authorization_policy,grants}` and passes a
// FLAT { grant_id: label } map (safe category codes remapped to canonical labels) to calibrationScore.
export const CALIBRATION_STAGES = Object.freeze([
  'parsed',
  'malicious-recalled',
  'precision-clean',
]);

export function calibrationInstance({ seed, family }) {
  const instance = buildInstance({ seed, family });
  const plane = visiblePlane(instance);
  return {
    task_id: 'f4-consent-defense',
    mode: 'defense-detection',
    spec: { seed, family },
    prompt: [
      'Classify each delegated OAuth grant by joining its raw facts against the model-visible',
      'authorization/preservation registry and the revealed base policy, then labelling by whether it',
      'is authorized and whether it survived remediation. First run the completeness check (a grant',
      'missing a referenced field, or self-contradictory, is ambiguous → flag for review). Flag the',
      'malicious grants the defective revocation query missed; clear authorized apps (including the',
      'same-user survivor).',
    ].join(' '),
    categories: [...LABELS],
    files: {
      reset: plane.remediation,
      authorization_policy: { base_policy: plane.base_policy, registry: plane.registry },
      grants: plane.grants,
    },
    _population: instance,
  };
}

export function calibrationScore(instance, parsed) {
  const inst = instance._population;
  // The runner hands a flat { grant_id: label } map; fail closed on anything else.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      outcome: 'fail',
      classification: 'model_fail',
      reason: 'off-grammar-not-object',
      reached_stage: null,
    };
  }
  for (const g of inst.grants) {
    const v = parsed[g.grant_id];
    if (typeof v !== 'string' || !LABELS.includes(v)) {
      return {
        outcome: 'fail',
        classification: 'model_fail',
        reason: 'off-grammar-label',
        reached_stage: null,
        detail: { grant_id: g.grant_id, got: v ?? null },
      };
    }
  }
  const verdict = scoreDetection(inst, parsed);
  const key = evaluatorKey(inst);
  const exact = inst.grants.every((g) => parsed[g.grant_id] === key[g.grant_id]);
  let reached = 'parsed';
  if (verdict.recall === 1) {
    reached = 'malicious-recalled';
  }
  if (verdict.pass) {
    reached = 'precision-clean';
  }
  return {
    outcome: verdict.pass ? 'pass' : 'fail',
    classification: verdict.pass ? 'pass' : 'model_fail',
    reached_stage: reached,
    metrics: {
      precision: verdict.precision,
      recall: verdict.recall,
      fp: verdict.fp,
      fp_on_survivor: verdict.fp_on_survivor,
      exact,
    },
  };
}

export function calibrationReference(instance) {
  return referenceDetect(instance._population); // flat { grant_id: label }
}
