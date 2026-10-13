// F5 shared corpus — the per-field counterexample scenarios the detector scores + the producer-native
// capture. Mirrors F3/F10: `corpusScenarios` keeps the evaluator intent (the English class) so the shared
// labelArtifact can recompute the per-artifact key; `buildCorpus` strips it, emitting model-visible native
// provenance facts only (artifacts + the release policy + channels). The matched legitimate-release shares
// EVERY observable field with the break (same signature, new/emergency/cache flags, deploy target, key
// sets, list lengths, digest formats) — they differ only in whether the resolved provenance chain is
// SANCTIONED by policy, so no single field is an oracle (label-policy.md "no single field decides").

import {
  buildWorld,
  makeArtifact,
  sha256Hex,
  visibleArtifact,
  visibleChannel,
  visiblePolicy,
} from './estate.mjs';

function scenarioId(seed, family, tag) {
  return `f5s-${sha256Hex(`f5|scn|${seed}|${family}|${tag}`).slice(0, 12)}`;
}

/** The per-(seed, family) scenarios. Each is a set of native artifacts + an evaluator-only `intent` (the
 * English class). The world (policy/channels/material) is re-derivable via buildWorld. */
export function corpusScenarios(seed, family) {
  const world = buildWorld({ seed, family });
  const scen = (intent, artifacts) => ({
    scenario_id: scenarioId(seed, family, intent),
    intent,
    artifacts,
  });
  const brk = (tag, flags) => makeArtifact(world, { kind: 'break', family, tag, flags });
  const legit = (tag, flags) => makeArtifact(world, { kind: 'legit', family, tag, flags });

  return [
    // the break + the matched legitimate twin — together the per-field counterexample set (identical
    // signature/new/emergency/cache/deploy-target/shape; differ only in the sanctioned provenance chain).
    scen('provenance-break', [brk('brk', { new: true })]),
    scen('legitimate-release', [legit('leg', { new: true })]),
    // mixed: both present in one scenario, so the detector must label each (not guess by population).
    scen('matched-pair', [brk('pair-b', { new: true }), legit('pair-l', { new: true })]),
    // benign flag counterexamples (emergency / cache-reuse are each sound) — flag ≠ signal.
    scen('legit-emergency', [legit('emg', { new: true, emergency: true })]),
    scen('legit-cache', [legit('cache', { new: false, cache: true })]),
    // ambiguous: a required chain field missing -> soundness cannot be decided.
    scen('ambiguous-incomplete', [
      makeArtifact(world, { kind: 'ambiguous-incomplete', family, tag: 'inc' }),
    ]),
    // ambiguous: attestation contradicts the resolved chain -> cannot decide (NOT a break).
    scen('ambiguous-conflict', [
      makeArtifact(world, { kind: 'ambiguous-conflict', family, tag: 'cfl' }),
    ]),
  ];
}

/** Model-visible capture rows for one (seed, family): native artifacts + the visible world (policy +
 * channels). NO intent, NO label/verdict. The evaluator re-derivation key rides as `_evaluator` (stripped
 * from the observation plane). */
export function buildCorpus(seed, family) {
  const world = buildWorld({ seed, family });
  const visible_world = {
    release_policy: visiblePolicy(world),
    channels: world.channels.map((c) => visibleChannel(c)),
  };
  return corpusScenarios(seed, family).map((s) => ({
    scenario_id: s.scenario_id,
    seed,
    family,
    visible_world,
    artifacts: s.artifacts.map((a) => visibleArtifact(a)),
    _evaluator: { seed, family, intent: s.intent },
  }));
}
