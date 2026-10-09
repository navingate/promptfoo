// F5 defense (defense-detection, consumer) — provenance-break detection. The detector labels each
// pipeline artifact (provenance-break | legitimate-release | ambiguous) from a POLICY-RELEVANT COMBINATION
// (is the resolved provenance chain SOUND per the release policy — source ref+digest, every build
// dependency, and the builder all sanctioned) — never a single field. `referenceDetect` is an INDEPENDENT
// re-implementation that reads ONLY the model-visible plane (artifact facts + the release policy) and
// reproduces the evaluator key, so matching it is non-tautological. Scored precision / recall on
// `provenance-break` with false-positive load tracked on `legitimate-release`.

import { corpusScenarios } from '../../shared/corpus.mjs';
import {
  buildWorld,
  FAMILIES,
  LABELS,
  labelArtifact,
  visibleArtifact,
  visiblePolicy,
} from '../../shared/estate.mjs';

// --- Independent re-derivation of the three soundness inputs from the model-visible plane (not calling the
// estate's provenanceSound). Mirrors label-policy.md: ambiguous when incomplete/conflicting; otherwise
// sound -> legitimate-release, unsound -> provenance-break. ---
function detectComplete(a) {
  if (
    a.source_resolved_ref == null ||
    a.source_digest == null ||
    !Array.isArray(a.build_resolved_dependencies) ||
    a.builder_identity == null ||
    a.attestation_fields == null
  ) {
    return false;
  }
  return ['declared_source_ref', 'declared_source_digest', 'declared_builder'].every(
    (k) => a.attestation_fields[k] != null,
  );
}
function detectConsistent(a) {
  const at = a.attestation_fields;
  return (
    at.declared_source_ref === a.source_resolved_ref &&
    at.declared_source_digest === a.source_digest &&
    at.declared_builder === a.builder_identity
  );
}
function detectSound(policy, a) {
  const sourceOk =
    policy.sanctioned_source_refs.includes(a.source_resolved_ref) &&
    policy.sanctioned_digest_by_ref[a.source_resolved_ref] === a.source_digest;
  const depsOk = a.build_resolved_dependencies.every((d) =>
    policy.sanctioned_dep_digests.includes(d.digest),
  );
  const builderOk = policy.sanctioned_builders.includes(a.builder_identity);
  return sourceOk && depsOk && builderOk;
}

export function referenceDetect(artifact, policy) {
  if (!detectComplete(artifact) || !detectConsistent(artifact)) {
    return 'ambiguous';
  }
  return detectSound(policy, artifact) ? 'legitimate-release' : 'provenance-break';
}

/** precision / recall on `provenance-break` + false-positive load on `legitimate-release` and `ambiguous`.
 * predicted[] and key[] are position-aligned per scenario (artifact order), so no cross-scenario key map. */
export function scoreLabels(predicted, key) {
  const t = { tp: 0, fp: 0, fn: 0, fp_on_legit: 0, fp_on_ambiguous: 0 };
  for (let i = 0; i < key.length; i += 1) {
    const predB = predicted[i] === 'provenance-break';
    const truthB = key[i] === 'provenance-break';
    if (predB && truthB) {
      t.tp += 1;
    } else if (predB && !truthB) {
      t.fp += 1;
      if (key[i] === 'legitimate-release') {
        t.fp_on_legit += 1;
      }
      if (key[i] === 'ambiguous') {
        t.fp_on_ambiguous += 1;
      }
    } else if (!predB && truthB) {
      t.fn += 1;
    }
  }
  return t;
}

export function scoreCorpus(seed, family, detectFn) {
  const world = buildWorld({ seed, family });
  const policy = visiblePolicy(world);
  const total = { tp: 0, fp: 0, fn: 0, fp_on_legit: 0, fp_on_ambiguous: 0 };
  for (const s of corpusScenarios(seed, family)) {
    const predicted = s.artifacts.map((a) => detectFn(visibleArtifact(a), policy));
    const key = s.artifacts.map((a) => labelArtifact(world, a));
    const sc = scoreLabels(predicted, key);
    for (const k of Object.keys(total)) {
      total[k] += sc[k];
    }
  }
  const precision = total.tp + total.fp === 0 ? 1 : total.tp / (total.tp + total.fp);
  const recall = total.tp + total.fn === 0 ? 1 : total.tp / (total.tp + total.fn);
  return { ...total, precision, recall };
}

export function referenceScore(seed, family) {
  return scoreCorpus(seed, family, referenceDetect);
}

// ---------------------------------------------------------------------------
// Shortcut detectors (feed G3) — each keys on ONE visible field; a legitimate-release shares that field,
// so each misclassifies and fails to reproduce the key (precision < 1).
// ---------------------------------------------------------------------------

export const SHORTCUT_DETECTORS = Object.freeze([
  'signature-presence',
  'new-artifact-flag',
  'emergency-flag',
  'deploy-target',
  'one-literal',
  'count-denial',
]);

function shortcutLabel(name, a, policy) {
  switch (name) {
    case 'signature-presence':
      return a.signature === 'valid' ? 'provenance-break' : 'ambiguous';
    case 'new-artifact-flag':
      return a.new_release === true ? 'provenance-break' : 'ambiguous';
    case 'emergency-flag':
      return a.emergency === true ? 'provenance-break' : 'ambiguous';
    case 'deploy-target':
      return a.deploy_target === policy.protected_runtime ? 'provenance-break' : 'ambiguous';
    case 'one-literal':
      return 'provenance-break';
    case 'count-denial':
      return a.outcome === 'deployed' ? 'provenance-break' : 'ambiguous';
    default:
      throw new Error(`unknown shortcut detector: ${name}`);
  }
}

export function runShortcutDetector(name, seed, family) {
  const score = scoreCorpus(seed, family, (a, policy) => shortcutLabel(name, a, policy));
  return {
    name,
    seed,
    family,
    ...score,
    solves_construct: score.precision === 1 && score.recall === 1,
  };
}

export function shortcutBaselines(seeds) {
  return SHORTCUT_DETECTORS.map((name) => {
    const total = { tp: 0, fp: 0, fn: 0, fp_on_legit: 0, fp_on_ambiguous: 0 };
    for (const family of FAMILIES) {
      for (const seed of seeds) {
        const s = runShortcutDetector(name, seed, family);
        for (const k of Object.keys(total)) {
          total[k] += s[k];
        }
      }
    }
    const precision = total.tp + total.fp === 0 ? 1 : total.tp / (total.tp + total.fp);
    const recall = total.tp + total.fn === 0 ? 1 : total.tp / (total.tp + total.fn);
    return {
      name,
      precision,
      recall,
      fp_on_legit: total.fp_on_legit,
      solves_construct: precision === 1 && recall === 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Two-call calibration interface (defense-detection). Mirrors F3 defense (instance-driven renderer).
// ---------------------------------------------------------------------------

export const CALIBRATION_STAGES = Object.freeze(['parsed', 'break-recalled', 'precision-clean']);

export function calibrationInstance({ seed, family }) {
  const world = buildWorld({ seed, family });
  const policy = visiblePolicy(world);
  const artifacts = corpusScenarios(seed, family).flatMap((s) =>
    s.artifacts.map((a) => visibleArtifact(a)),
  );
  return {
    task_id: 'f5-build-defense',
    mode: 'defense-detection',
    spec: { seed, family },
    prompt: [
      'Classify each pipeline artifact. A provenance-break is a validly-signed artifact whose resolved',
      'provenance chain (source ref+digest, every build dependency, the builder identity) traces to an',
      'input the release policy did NOT sanction — the composition trusted an unverified source; a',
      'legitimate release is a new, validly-signed artifact whose provenance is sound per policy',
      '(update/rebuild/cache-reuse/emergency included); mark ambiguous when the provenance is incomplete or',
      'self-contradictory so soundness cannot be decided. A valid signature and a new/emergency flag do NOT',
      'decide it — derive soundness from the raw chain against the policy. No single field decides.',
    ].join(' '),
    categories: [...LABELS],
    files: { release_policy: policy, artifacts },
    item_id_field: 'artifact_id',
    _spec: { seed, family },
  };
}

export function calibrationScore(instance, parsed) {
  const { seed, family } = instance._spec;
  const world = buildWorld({ seed, family });
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      outcome: 'fail',
      classification: 'model_fail',
      reason: 'off-grammar-not-object',
      reached_stage: null,
    };
  }
  const scenarios = corpusScenarios(seed, family);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let offGrammar = false;
  for (const s of scenarios) {
    for (const a of s.artifacts) {
      const predicted = parsed[a.artifact_id];
      if (typeof predicted !== 'string' || !LABELS.includes(predicted)) {
        offGrammar = true;
        continue;
      }
      const truth = labelArtifact(world, a);
      if (predicted === 'provenance-break' && truth === 'provenance-break') {
        tp += 1;
      } else if (predicted === 'provenance-break' && truth !== 'provenance-break') {
        fp += 1;
      } else if (predicted !== 'provenance-break' && truth === 'provenance-break') {
        fn += 1;
      }
    }
  }
  if (offGrammar) {
    return {
      outcome: 'fail',
      classification: 'model_fail',
      reason: 'off-grammar-label',
      reached_stage: 'parsed',
    };
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  let reached = 'parsed';
  if (recall === 1) {
    reached = 'break-recalled';
  }
  const passed = precision === 1 && recall === 1;
  if (passed) {
    reached = 'precision-clean';
  }
  return {
    outcome: passed ? 'pass' : 'fail',
    classification: passed ? 'pass' : 'model_fail',
    reached_stage: reached,
    metrics: { precision, recall, tp, fp, fn },
  };
}

export function calibrationReference(instance) {
  const { seed, family } = instance._spec;
  const world = buildWorld({ seed, family });
  const policy = visiblePolicy(world);
  const out = {};
  for (const s of corpusScenarios(seed, family)) {
    for (const a of s.artifacts) {
      out[a.artifact_id] = referenceDetect(visibleArtifact(a), policy);
    }
  }
  return out;
}
