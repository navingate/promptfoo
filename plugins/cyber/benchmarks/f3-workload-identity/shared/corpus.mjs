// F3 shared corpus — the per-field counterexample scenarios the detector scores + the producer-native
// capture. Mirrors F10's corpus: `corpusScenarios` keeps the evaluator intent (the English class) so the
// shared labelFlow can recompute the per-flow key; `buildCorpus` strips it, emitting model-visible native
// facts only (flows + the visible world). The matched approved-deployment shares EVERY observable field
// with the cascade (same controller action, token use, data access, operation sequence, provenance shape)
// — they differ only in the DERIVED combination (workload lacks direct authority AND the delegation is
// unsanctioned), so no single field is an oracle.

import {
  buildWorld,
  labelFlow,
  makeFlow,
  sha256Hex,
  visibleController,
  visibleFlow,
  visiblePolicy,
  visibleWorkload,
} from './estate.mjs';

function scenarioId(seed, family, tag) {
  return `f3s-${sha256Hex(`f3|scn|${seed}|${family}|${tag}`).slice(0, 12)}`;
}

/** The per-(seed, family) scenarios. Each scenario is a set of native flows + an evaluator-only `intent`
 * (the English class). The world (controllers/policy/workloads) is re-derivable via buildWorld. */
export function corpusScenarios(seed, family) {
  const world = buildWorld({ seed, family });
  const weak = world.evaluator.weak_controller_id;
  const compromised = world.workloads.find((w) => w.compromised).id;
  const approved = world.workloads.find((w) => !w.compromised).id;
  // the self-sufficient workload holds direct cloud authority for the protected role (unsanctioned).
  const selfSufficient = world.workloads.find((w) =>
    w.rbac_verbs.includes(`access:${world.protected_role}`),
  ).id;
  const scen = (intent, flows) => ({
    scenario_id: scenarioId(seed, family, intent),
    intent,
    flows,
  });

  const cascade = (tag) =>
    makeFlow(world, {
      workloadId: compromised,
      controllerId: weak,
      outcome: 'completed-access',
      tag,
    });
  const approvedFlow = (tag) =>
    makeFlow(world, { workloadId: approved, controllerId: weak, outcome: 'completed-access', tag });

  return [
    // the cascade + the matched approved twin — together they are the per-field counterexample set
    // (identical controller/token/data-access/operation/provenance shape; differ only in the combination).
    scen('cascade', [cascade('casc')]),
    scen('approved-deployment', [approvedFlow('appr')]),
    // mixed: both present in one scenario, so the detector must label each (not guess by population).
    scen('matched-pair', [cascade('pair-c'), approvedFlow('pair-a')]),
    // ambiguous: a partial flow that never reached cloud authority (per the defense threat-model).
    scen('ambiguous-partial', [
      makeFlow(world, {
        workloadId: compromised,
        controllerId: weak,
        outcome: 'partial',
        tag: 'part',
      }),
    ]),
    // ambiguous: completed-shaped but the consumed-object provenance is missing -> cannot decide.
    scen('ambiguous-missing', [
      { ...cascade('miss'), consumed_object: { created_by: null, ref_field: null } },
    ]),
    // ambiguous: the weak controller acts on-behalf of a workload that ALREADY has direct authority for the
    // role (unsanctioned). No privilege is cascaded, so this is ambiguous, not a cascade. Per-field
    // counterexample making `lacks-direct-authority` load-bearing: without it, (on-behalf AND unsanctioned)
    // alone reproduces the cascade key.
    scen('ambiguous-has-direct', [
      makeFlow(world, {
        workloadId: selfSufficient,
        controllerId: weak,
        outcome: 'completed-access',
        tag: 'hasdir',
      }),
    ]),
  ];
}

/** Return the model-visible capture rows for one (seed, family): native flows + the visible world
 * (controllers/workloads/policy). NO intent, NO label/verdict. The evaluator re-derivation key rides as
 * `_evaluator` (stripped from the observation plane). */
export function buildCorpus(seed, family) {
  const world = buildWorld({ seed, family });
  const visible_world = {
    workloads: world.workloads.map((w) => visibleWorkload(w)),
    controllers: world.controllers.map((c) => visibleController(c)),
    policy: visiblePolicy(world),
  };
  return corpusScenarios(seed, family).map((s) => ({
    scenario_id: s.scenario_id,
    seed,
    family,
    visible_world,
    flows: s.flows.map((f) => visibleFlow(f)),
    _evaluator: { seed, family, intent: s.intent },
  }));
}

/** The evaluator label key for a scenario's flows (shared labelFlow over the re-derived world). */
export function scenarioKey(seed, family, scenario) {
  const world = buildWorld({ seed, family });
  return scenario.flows.map((f) => labelFlow(world, f));
}
