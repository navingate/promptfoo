# Wave 1 model-free verification

Run from the repository root with the version in `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use`). The implementation commit for this evidence bundle is `1ff567356f5e`; the following metadata commit records its manifest and artifact hashes. The six tasks are under `f9-secret-rotation`, `f6-poisoned-change`, and `f4-durable-consent`, each with `offense` and `defense` modes.

```bash
node --test plugins/cyber/benchmarks/_tooling/wave1-regression.test.mjs
for family in f9-secret-rotation f6-poisoned-change f4-durable-consent; do
  for mode in offense defense; do
    task="plugins/cyber/benchmarks/$family/$mode"
    node .agents/skills/cyber-benchmark-authoring/scripts/audit_benchmark.mjs --repo-root . --task "$task" --commit 1ff567356f5e6c2080a8c495ce43768d67c0c92c
    node .agents/skills/cyber-benchmark-authoring/scripts/audit_telemetry_contract.mjs --repo-root . --task "$task" --commit 1ff567356f5e6c2080a8c495ce43768d67c0c92c
  done
done
```

The benchmark auditor exits nonzero for intentionally pending gates. Expected findings: G0, G6, G7 for all six tasks, plus G4 for the F9 pair. Any other finding is a regression. The telemetry auditor must report `PASS: 0 finding(s)` for all six. The reference and negative-control outputs are in each task's `evidence/` directory; inspect the counts and per-case statuses rather than only process exit codes.

To regenerate artifacts, run each family in producer-then-consumer order, then bind all six manifests to the implementation commit. Regeneration writes files. Compare their contents and SHA-256 values before committing changes.

```bash
for family in f9-secret-rotation f6-poisoned-change f4-durable-consent; do
  node "plugins/cyber/benchmarks/$family/offense/scripts/generate-evidence.mjs"
  node "plugins/cyber/benchmarks/$family/defense/scripts/generate-evidence.mjs"
done
for family in f9-secret-rotation f6-poisoned-change f4-durable-consent; do
  for mode in offense defense; do
    node "plugins/cyber/benchmarks/$family/$mode/scripts/build-manifest.mjs" --commit 1ff567356f5e6c2080a8c495ce43768d67c0c92c
  done
done
```

## Gate status and limits

| Gate               | F9 pair                                                                                                                                                                        | F6 pair                                                            | F4 pair                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| G0 construct       | Pending formal current independent approval; prior design review is historical evidence                                                                                        | Same                                                               | Same                                                               |
| G1 reference       | Pass: 60/60 offense, 180/180 defense                                                                                                                                           | Pass: 60/60 offense, 180/180 defense                               | Pass: 80/80 offense; defense 512 grants, precision/recall 1        |
| G2 security/oracle | Pass in the declared staged context; malformed-ledger controls and telemetry audit checked                                                                                     | Pass in the declared staged context                                | Pass in the declared staged context                                |
| G3 shortcuts       | Pass for declared model-free baselines and mutations                                                                                                                           | Pass for declared model-free baselines and mutations               | Pass, including position baseline after grant-order randomization  |
| G4 pairing         | **Pending**: native malicious and full-rotation benign captures reconstruct, but the live incident still regenerates state by seed instead of initializing from those captures | Pass for frozen corpus conformance, 180/180 cases                  | Pass for frozen corpus conformance, 64/64 populations              |
| G5 operations      | Pass for declared deterministic simulation and model-free workflow                                                                                                             | Pass for declared deterministic simulation and model-free workflow | Pass for declared deterministic simulation and model-free workflow |

G2 and G5 cover the portable in-memory estates and their declared failure states. They do not establish host isolation of a later model runner, resilience to unmodeled provider faults, or fidelity to a particular cloud or identity product. G6 model calibration and G7 claim approval remain pending for every task. No achieved evidence level or deployment conclusion is claimed.

The F9 G4 blocker is semantic: reconstructing inventory from producer events is not the same as initializing the responder's live state from the immutable capture. The current adapter must not fill missing accept/revoke facts from seed or invent them. A faithful capture-to-snapshot contract and matched benign response case are required before that gate can pass.
