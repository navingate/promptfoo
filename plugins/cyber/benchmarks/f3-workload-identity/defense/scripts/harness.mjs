// F3 defense (defense-detection, consumer) — cascade-correlation. The detector labels each workload->
// controller->cloud flow (cascade | approved-deployment | ambiguous) from a POLICY-RELEVANT COMBINATION
// (did a controller act on behalf of a workload lacking direct authority, AND was that delegation
// sanctioned) — never a single field. `referenceDetect` is an INDEPENDENT re-implementation that reads
// ONLY the model-visible plane (flow fields + the visible world's RBAC, reconcile checks, and
// authorized-bindings policy) and reproduces the evaluator key, so matching it is non-tautological. Scored
// precision / recall on `cascade` with false-positive load tracked on `approved-deployment`.

import { corpusScenarios } from '../../shared/corpus.mjs';
import {
  buildWorld,
  FAMILIES,
  LABELS,
  labelFlow,
  visibleFlow,
  visibleWorld,
} from '../../shared/estate.mjs';

// --- The three POLICY-RELEVANT booleans the detector derives from the model-visible plane. Single source
// of truth, reused by `referenceDetect` AND the de-oracle / no-oracle brute-force so they cannot drift.
//  - on_behalf: a completed flow whose controller used its own SA on a workload-supplied object (the
//    controller acted FOR the workload). Non-completed / missing-provenance flows are not on-behalf.
//  - sanctioned: the authorized-bindings policy sanctions this workload->role delegation.
//  - lacks_direct: the workload's own RBAC cannot reach the role (so the delegation would ESCALATE). ---
export function derivedSignals(flow, vw) {
  const hasProvenance =
    !!flow.consumed_object && flow.consumed_object.created_by != null && !!flow.cloud_action;
  const on_behalf =
    flow.outcome === 'completed-access' &&
    hasProvenance &&
    flow.cloud_action.effective_authority_kind === 'controller-sa' &&
    flow.consumed_object.created_by === flow.workload_id;
  const role = flow.cloud_action?.target_role;
  const sanctioned = (vw.policy.authorized_bindings ?? []).some(
    (b) => b.workload === flow.workload_id && b.role === role && b.sanctioned_task === true,
  );
  const wl = vw.workloads.find((w) => w.id === flow.workload_id);
  const lacks_direct = !wl || !wl.rbac_verbs.includes(`access:${role}`);
  return { on_behalf, sanctioned, lacks_direct };
}

// --- INDEPENDENT re-derivation from the model-visible plane (not calling the estate labelFlow). A
// completed on-behalf flow already implies a non-validating controller consumed it (a validating one would
// have denied the unsanctioned requester -> partial -> ambiguous), so the label is outcome-based. Cascade
// needs the FULL combination: on-behalf AND unsanctioned AND the workload lacks direct authority — no
// single field or pair is an oracle (see the no-oracle brute-force in generate-evidence). ---
export function referenceDetect(flow, vw) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  if (!flow.consumed_object || flow.consumed_object.created_by == null || !flow.cloud_action) {
    return 'ambiguous';
  }
  const { on_behalf, sanctioned, lacks_direct } = derivedSignals(flow, vw);
  if (!on_behalf) {
    return 'ambiguous';
  }
  if (sanctioned) {
    return 'approved-deployment';
  }
  return lacks_direct ? 'cascade' : 'ambiguous';
}

/** precision / recall on `cascade` + false-positive load on `approved-deployment` and `ambiguous`.
 * predicted[] and key[] are position-aligned per scenario (flow order), so no cross-scenario key map. */
export function scoreLabels(predicted, key) {
  const t = { tp: 0, fp: 0, fn: 0, fp_on_approved: 0, fp_on_ambiguous: 0 };
  for (let i = 0; i < key.length; i += 1) {
    const predC = predicted[i] === 'cascade';
    const truthC = key[i] === 'cascade';
    if (predC && truthC) {
      t.tp += 1;
    } else if (predC && !truthC) {
      t.fp += 1;
      if (key[i] === 'approved-deployment') {
        t.fp_on_approved += 1;
      }
      if (key[i] === 'ambiguous') {
        t.fp_on_ambiguous += 1;
      }
    } else if (!predC && truthC) {
      t.fn += 1;
    }
  }
  return t;
}

export function scoreCorpus(seed, family, detectFn) {
  const world = buildWorld({ seed, family });
  const vw = visibleWorld(world);
  const total = { tp: 0, fp: 0, fn: 0, fp_on_approved: 0, fp_on_ambiguous: 0 };
  for (const s of corpusScenarios(seed, family)) {
    const predicted = s.flows.map((f) => detectFn(visibleFlow(f), vw));
    const key = s.flows.map((f) => labelFlow(world, f));
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
// Shortcut detectors (feed G3) — each keys on ONE field; an approved-deployment shares that field, so
// each misclassifies and fails to reproduce the key (precision < 1).
// ---------------------------------------------------------------------------

export const SHORTCUT_DETECTORS = Object.freeze([
  'controller-action-alone',
  'token-alone',
  'provenance-alone',
  'data-access-alone',
  'one-literal',
  'count-denial',
]);

function shortcutLabel(name, flow, vw) {
  switch (name) {
    case 'controller-action-alone':
      return flow.cloud_action?.effective_authority_kind === 'controller-sa'
        ? 'cascade'
        : 'ambiguous';
    case 'token-alone':
      return flow.token_use?.kind === 'service-account-token' ? 'cascade' : 'ambiguous';
    case 'provenance-alone':
      return flow.consumed_object?.created_by == null ? 'ambiguous' : 'cascade';
    case 'data-access-alone':
      return flow.cloud_action?.target_role === vw.policy.protected_role ? 'cascade' : 'ambiguous';
    case 'one-literal':
      return 'cascade';
    case 'count-denial':
      return flow.outcome === 'completed-access' ? 'cascade' : 'ambiguous';
    default:
      throw new Error(`unknown shortcut detector: ${name}`);
  }
}

export function runShortcutDetector(name, seed, family) {
  const score = scoreCorpus(seed, family, (flow, vw) => shortcutLabel(name, flow, vw));
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
    const total = { tp: 0, fp: 0, fn: 0, fp_on_approved: 0, fp_on_ambiguous: 0 };
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
      fp_on_approved: total.fp_on_approved,
      solves_construct: precision === 1 && recall === 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Two-call calibration interface (defense-detection). F3 reuses the F10 detection-renderer generalization
// (consolidated F2 Chain ask) + f3 DETECTION_SAFE_CODE. This defines the shape.
// ---------------------------------------------------------------------------

export const CALIBRATION_STAGES = Object.freeze(['parsed', 'cascade-recalled', 'precision-clean']);

export function calibrationInstance({ seed, family }) {
  const world = buildWorld({ seed, family });
  const vw = visibleWorld(world);
  // one instance = all flows across the seed/family scenarios, each with a stable flow_id to classify.
  const flows = corpusScenarios(seed, family).flatMap((s) => s.flows.map((f) => visibleFlow(f)));
  return {
    task_id: 'f3-workload-defense',
    mode: 'defense-detection',
    spec: { seed, family },
    prompt: [
      'Classify each workload->controller->cloud flow. A cascade is where a controller acted on behalf of a',
      'workload that lacks direct authority for the reached cloud role AND the delegation is not sanctioned',
      'by the authorized-bindings policy; an approved deployment is the same operations where the delegation',
      'is sanctioned; mark ambiguous when a flow never reached cloud authority or its provenance is missing.',
      'Derive the delegation verdict from the raw RBAC, the controller reconcile checks, and the policy — no',
      'single field decides.',
    ].join(' '),
    categories: [...LABELS],
    files: { world: vw, flows },
    item_id_field: 'flow_id',
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
    for (const f of s.flows) {
      const predicted = parsed[f.flow_id];
      if (typeof predicted !== 'string' || !LABELS.includes(predicted)) {
        offGrammar = true;
        continue;
      }
      const truth = labelFlow(world, f);
      if (predicted === 'cascade' && truth === 'cascade') {
        tp += 1;
      } else if (predicted === 'cascade' && truth !== 'cascade') {
        fp += 1;
      } else if (predicted !== 'cascade' && truth === 'cascade') {
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
    reached = 'cascade-recalled';
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
  const vw = visibleWorld(buildWorld({ seed, family }));
  const out = {};
  for (const s of corpusScenarios(seed, family)) {
    for (const f of s.flows) {
      out[f.flow_id] = referenceDetect(visibleFlow(f), vw);
    }
  }
  return out;
}
