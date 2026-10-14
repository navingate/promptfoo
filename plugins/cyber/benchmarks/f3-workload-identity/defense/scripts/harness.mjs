// F3 v2 defense (defense-detection, consumer) — cascade-correlation. The detector labels each
// workload->controller->cloud flow (cascade | approved-deployment | ambiguous) from the model-visible
// plane: the native flows, the AUDIT LOG, and the authorization grants. The decisive derivation (idea 1):
// resolve the AUTHENTICATED WRITER of each flow's CAUSAL object revision via an audit-log join on
// (object_uid, causal_ref) over create/patch entries (status-updates do not move the causal writer;
// annotations.owner is not authoritative), then test whether a grant names that writer AND covers the task
// (store, remote_ref, action). `referenceDetect` reads ONLY the visible plane and reproduces the evaluator
// key, so matching it is non-tautological. Scored precision/recall on `cascade` with FP load on
// `approved-deployment` and `ambiguous` tracked separately (Q5 FP pressure).

import { buildDefenseCorpus } from '../../shared/corpus.mjs';
import {
  CORPUS_SEEDS,
  FAMILIES,
  flowTask,
  grantsCover,
  LABELS,
  labelFlow,
  resolveCausalWriter,
  visibleAuditEntry,
  visibleFlow,
  visiblePolicy,
  visibleWorld,
} from '../../shared/estate.mjs';

/** The model-visible context the detector reasons over: the audit log + the authorization grants. */
function visibleContext(world) {
  return {
    audit: world.audit.map((e) => visibleAuditEntry(e)),
    grants: visiblePolicy(world).grants,
  };
}

/** INDEPENDENT re-derivation from the model-visible plane (does NOT call the estate labelFlow nor read any
 * evaluator field). A completed flow's causal writer is resolved from the audit log by (object_uid,
 * causal_ref) over spec-changing writes; coverage needs the FULL (writer AND task) match. */
export function referenceDetect(flow, ctx) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  const writer = resolveCausalWriter(ctx.audit, flow.object_ref?.uid, flow.causal_ref);
  if (writer === null) {
    return 'ambiguous';
  }
  return grantsCover(ctx.grants, writer, flowTask(flow)) ? 'approved-deployment' : 'cascade';
}

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
  const { world, flows } = buildDefenseCorpus(seed, family);
  const ctx = visibleContext(world);
  const predicted = flows.map((f) => detectFn(visibleFlow(f), ctx));
  const key = flows.map((f) => labelFlow(world, f));
  const sc = scoreLabels(predicted, key);
  const precision = sc.tp + sc.fp === 0 ? 1 : sc.tp / (sc.tp + sc.fp);
  const recall = sc.tp + sc.fn === 0 ? 1 : sc.tp / (sc.tp + sc.fn);
  return { ...sc, precision, recall };
}

export function referenceScore(seed, family) {
  return scoreCorpus(seed, family, referenceDetect);
}

// ---------------------------------------------------------------------------
// Shortcut detectors (feed G3) — including readers that attack the JOINS, not just flow scalars. Each MUST
// fail to reproduce the key (precision/recall != 1 on the corpus).
// ---------------------------------------------------------------------------

export const SHORTCUT_DETECTORS = Object.freeze([
  'creator-by-name', // earliest create matching object NAME (ignores uid) -> fooled by recreation
  'annotation-owner', // trust annotations.owner as the writer -> spoofable
  'latest-audit-entry', // writer = latest audit entry of any verb -> fooled by trailing status-update
  'writer-in-any-grant', // "covered" iff the causal writer appears in ANY grant (ignores task)
  'positional-first', // label the first flow cascade (positional)
  'all-cascade',
]);

function creatorByName(flow, ctx) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  const byName = ctx.audit.filter(
    (e) => e.object_name === flow.object_ref?.name && (e.verb === 'create' || e.verb === 'patch'),
  );
  if (byName.length === 0) {
    return 'ambiguous';
  }
  const writer = byName.sort((a, b) => a.revision - b.revision)[0].authenticated_writer; // earliest
  return grantsCover(ctx.grants, writer, flowTask(flow)) ? 'approved-deployment' : 'cascade';
}
function annotationOwner(flow, ctx, objectsByName) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  const owner = objectsByName[flow.object_ref?.name]?.annotations?.owner ?? null;
  if (owner === null) {
    return 'ambiguous';
  }
  return grantsCover(ctx.grants, owner, flowTask(flow)) ? 'approved-deployment' : 'cascade';
}
function latestAuditEntry(flow, ctx) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  const forUid = ctx.audit.filter((e) => e.object_uid === flow.object_ref?.uid);
  if (forUid.length === 0) {
    return 'ambiguous';
  }
  const writer = forUid.sort((a, b) => b.revision - a.revision)[0].authenticated_writer; // latest, any verb
  return grantsCover(ctx.grants, writer, flowTask(flow)) ? 'approved-deployment' : 'cascade';
}
function writerInAnyGrant(flow, ctx) {
  if (flow.outcome !== 'completed-access') {
    return 'ambiguous';
  }
  const writer = resolveCausalWriter(ctx.audit, flow.object_ref?.uid, flow.causal_ref);
  if (writer === null) {
    return 'ambiguous';
  }
  const inAny = ctx.grants.some((g) => g.writer_principal === writer);
  return inAny ? 'approved-deployment' : 'cascade';
}

export function runShortcutDetector(name, seed, family) {
  const { world, flows } = buildDefenseCorpus(seed, family);
  const ctx = visibleContext(world);
  const objectsByName = Object.fromEntries(world.objects.map((o) => [o.name, o]));
  const detect = (flow, index) => {
    switch (name) {
      case 'creator-by-name':
        return creatorByName(flow, ctx);
      case 'annotation-owner':
        return annotationOwner(flow, ctx, objectsByName);
      case 'latest-audit-entry':
        return latestAuditEntry(flow, ctx);
      case 'writer-in-any-grant':
        return writerInAnyGrant(flow, ctx);
      case 'positional-first':
        return index === 0 ? 'cascade' : 'ambiguous';
      case 'all-cascade':
        return 'cascade';
      default:
        throw new Error(`unknown shortcut detector: ${name}`);
    }
  };
  const predicted = flows.map((f, i) => detect(visibleFlow(f), i));
  const key = flows.map((f) => labelFlow(world, f));
  const sc = scoreLabels(predicted, key);
  const precision = sc.tp + sc.fp === 0 ? 1 : sc.tp / (sc.tp + sc.fp);
  const recall = sc.tp + sc.fn === 0 ? 1 : sc.tp / (sc.tp + sc.fn);
  return { name, seed, family, ...sc, precision, recall };
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
// Single-field + pair-field separator scans over the VISIBLE flow scalars, pooled across the whole corpus
// (so per-instance-unique ids cannot form a generalizable separator). No perfect separator = no leak.
// ---------------------------------------------------------------------------

function flowScalars(flow) {
  return {
    object_name: flow.object_ref?.name ?? null,
    object_uid: flow.object_ref?.uid ?? null,
    store_ref: flow.object_ref?.store_ref ?? null,
    causal_ref: flow.causal_ref ?? null,
    token_kind: flow.token_use?.kind ?? null,
    effective_authority: flow.cloud_action?.effective_authority ?? null,
    target_remote_ref: flow.cloud_action?.target?.remote_ref ?? null,
    target_action: flow.cloud_action?.target?.action ?? null,
    outcome: flow.outcome ?? null,
  };
}

function pooledCorpus(seeds) {
  const rows = [];
  for (const family of FAMILIES) {
    for (const seed of seeds) {
      const { world, flows } = buildDefenseCorpus(seed, family);
      for (const f of flows) {
        rows.push({
          scalars: flowScalars(visibleFlow(f)),
          isCascade: labelFlow(world, f) === 'cascade',
        });
      }
    }
  }
  return rows;
}

/** Best accuracy of any "field == value => cascade" predicate, pooled across the corpus. perfect=1.0. */
export function singleFieldSeparatorScan(seeds = CORPUS_SEEDS) {
  const rows = pooledCorpus(seeds);
  const fields = Object.keys(rows[0].scalars);
  let best = { field: null, value: null, accuracy: 0 };
  for (const field of fields) {
    const values = new Set(rows.map((r) => r.scalars[field]));
    for (const value of values) {
      let correct = 0;
      for (const r of rows) {
        const pred = r.scalars[field] === value;
        if (pred === r.isCascade) {
          correct += 1;
        }
      }
      const accuracy = correct / rows.length;
      if (accuracy > best.accuracy) {
        best = { field, value, accuracy };
      }
    }
  }
  return {
    rows: rows.length,
    best_accuracy: best.accuracy,
    best_field: best.field,
    perfect_separator: best.accuracy === 1,
  };
}

/** Best accuracy of any "(f1==v1) AND (f2==v2) => cascade" predicate, pooled. perfect=1.0. */
export function pairFieldSeparatorScan(seeds = CORPUS_SEEDS) {
  const rows = pooledCorpus(seeds);
  const fields = Object.keys(rows[0].scalars);
  let best = { fields: null, accuracy: 0 };
  for (let i = 0; i < fields.length; i += 1) {
    for (let j = i + 1; j < fields.length; j += 1) {
      const f1 = fields[i];
      const f2 = fields[j];
      const pairs = new Set(rows.map((r) => `${r.scalars[f1]}||${r.scalars[f2]}`));
      for (const pair of pairs) {
        const [v1, v2] = pair.split('||');
        let correct = 0;
        for (const r of rows) {
          const pred = String(r.scalars[f1]) === v1 && String(r.scalars[f2]) === v2;
          if (pred === r.isCascade) {
            correct += 1;
          }
        }
        const accuracy = correct / rows.length;
        if (accuracy > best.accuracy) {
          best = { fields: [f1, f2], accuracy };
        }
      }
    }
  }
  return {
    rows: rows.length,
    best_accuracy: best.accuracy,
    best_fields: best.fields,
    perfect_separator: best.accuracy === 1,
  };
}

// ---------------------------------------------------------------------------
// One-condition negative mutations (each must flip EXACTLY its own flow's label).
// ---------------------------------------------------------------------------

export const DEFENSE_MUTATIONS = Object.freeze([
  'grant-attacker-protected', // cascade flow -> approved-deployment
  'uncover-approved-initial', // approved-initial -> cascade (flip ONLY O1 rev1's causal writer to the attacker)
  'complete-incomplete-flow', // ambiguous-incomplete -> cascade (attacker writer, now completed)
  'add-matching-uid-entry', // ambiguous-unresolvable -> cascade (supply the missing (uid,rev) attacker write)
]);

export function runDefenseMutation(name, seed, family) {
  const { world, flows } = buildDefenseCorpus(seed, family);
  const attacker = world.workloads.find((w) => w.compromised).principal;
  const before = flows.map((f) => ({ intent: f._intent, label: labelFlow(world, f) }));
  if (name === 'grant-attacker-protected') {
    world.grants.push({
      grant_id: 'mut',
      writer_principal: attacker,
      task: {
        remote_ref: world.protected_target.remote_ref,
        action: world.protected_target.action,
      },
    });
  } else if (name === 'uncover-approved-initial') {
    // flip ONLY the causal writer of the approved-initial flow's revision (O1 rev1) to the attacker. The
    // cascade flow (O1 rev2) and approved-rotation (O2) are untouched -> exactly one flow flips.
    const f = flows.find((x) => x._intent === 'approved-initial');
    const entry = world.audit.find(
      (e) =>
        e.object_uid === f.object_ref.uid &&
        e.revision === f.causal_ref &&
        (e.verb === 'create' || e.verb === 'patch'),
    );
    entry.authenticated_writer = attacker;
  } else if (name === 'complete-incomplete-flow') {
    const f = flows.find((x) => x._intent === 'ambiguous-incomplete');
    f.outcome = 'completed-access';
  } else if (name === 'add-matching-uid-entry') {
    const f = flows.find((x) => x._intent === 'ambiguous-unresolvable');
    world.audit.push({
      event_id: 'mut',
      verb: 'patch',
      object_uid: f.object_ref.uid,
      object_name: f.object_ref.name,
      revision: f.causal_ref,
      authenticated_writer: attacker,
      event_time: 999,
    });
  }
  const after = flows.map((f) => ({ intent: f._intent, label: labelFlow(world, f) }));
  const flipped = after.filter((a, i) => a.label !== before[i].label).map((a) => a.intent);
  return { name, seed, family, flipped, before, after };
}

// ---------------------------------------------------------------------------
// Two-call calibration interface (defense-detection). Rendered by the shared runner's generic Wave 2/3
// detection renderer (prompt + each files block + a label per item).
// ---------------------------------------------------------------------------

export const CALIBRATION_STAGES = Object.freeze(['parsed', 'cascade-recalled', 'precision-clean']);

export function calibrationInstance({ seed, family }) {
  const { world, flows } = buildDefenseCorpus(seed, family);
  return {
    task_id: 'f3-workload-defense',
    mode: 'defense-detection',
    spec: { seed, family },
    prompt: [
      'Classify each workload->controller->cloud flow. A controller reconciles the CAUSAL (latest',
      'spec-changing) revision of an object and reads the referenced secret with its OWN cloud identity',
      'without checking the writer is authorized. A flow is a cascade when the AUTHENTICATED WRITER of its',
      'causal revision is NOT covered by a grant for the secret (remote_ref, action); an',
      'approved-deployment when that writer IS covered; ambiguous when the cloud action did not complete OR',
      'the causal writer cannot be resolved. Resolve the writer from the AUDIT LOG by (object_uid,',
      'causal_ref) over create/patch entries only — status-updates do not move the causal writer, a',
      'recreated object has a different uid, and annotations.owner is not authoritative. A grant must name',
      'the writer AND cover the secret; a writer appearing in some unrelated grant is not coverage.',
    ].join(' '),
    categories: [...LABELS],
    files: {
      world: visibleWorld(world),
      audit_log: world.audit.map((e) => visibleAuditEntry(e)),
      flows: flows.map((f) => visibleFlow(f)),
    },
    item_id_field: 'flow_id',
    _spec: { seed, family },
  };
}

export function calibrationScore(instance, parsed) {
  const { seed, family } = instance._spec;
  const { world, flows } = buildDefenseCorpus(seed, family);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      outcome: 'fail',
      classification: 'model_fail',
      reason: 'off-grammar-not-object',
      reached_stage: null,
    };
  }
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let fpApproved = 0;
  let fpAmbiguous = 0;
  let offGrammar = false;
  const confusion = {};
  for (const f of flows) {
    const predicted = parsed[f.flow_id];
    if (typeof predicted !== 'string' || !LABELS.includes(predicted)) {
      offGrammar = true;
      continue;
    }
    const truth = labelFlow(world, f);
    confusion[`${truth}->${predicted}`] = (confusion[`${truth}->${predicted}`] ?? 0) + 1;
    if (predicted === 'cascade' && truth === 'cascade') {
      tp += 1;
    } else if (predicted === 'cascade' && truth !== 'cascade') {
      fp += 1;
      if (truth === 'approved-deployment') {
        fpApproved += 1;
      } else {
        fpAmbiguous += 1;
      }
    } else if (predicted !== 'cascade' && truth === 'cascade') {
      fn += 1;
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
  const passed = precision === 1 && recall === 1;
  let reached = 'parsed';
  if (recall === 1) {
    reached = 'cascade-recalled';
  }
  if (passed) {
    reached = 'precision-clean';
  }
  return {
    outcome: passed ? 'pass' : 'fail',
    classification: passed ? 'pass' : 'model_fail',
    reached_stage: reached,
    metrics: {
      precision,
      recall,
      tp,
      fp,
      fn,
      fp_on_approved: fpApproved,
      fp_on_ambiguous: fpAmbiguous,
      confusion,
    },
  };
}

export function calibrationReference(instance) {
  const { seed, family } = instance._spec;
  const { world, flows } = buildDefenseCorpus(seed, family);
  const ctx = visibleContext(world);
  const out = {};
  for (const f of flows) {
    out[f.flow_id] = referenceDetect(visibleFlow(f), ctx);
  }
  return out;
}
