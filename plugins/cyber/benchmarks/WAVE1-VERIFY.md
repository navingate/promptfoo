# Wave 1 model-free verification

Run from the repository root with the version in `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use`). The implementation commit for the F4 and F6 evidence bundles is `1ff567356f5e`; the following metadata commit records its manifest and artifact hashes. **Update (F9 G4 fix):** the F9 pair (offense + defense) is now bound to `09f6074b1da2`, which lands the capture→snapshot initialization — **F9 G4 now passes**. Audit the F9 tasks with `--commit 09f6074b1da28d802978b9465bde5e5ba5fdbfd9` and the F4/F6 tasks with `--commit 1ff567356f5e6c2080a8c495ce43768d67c0c92c`. The six tasks are under `f9-secret-rotation`, `f6-poisoned-change`, and `f4-durable-consent`, each with `offense` and `defense` modes.

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

The benchmark auditor exits nonzero for intentionally pending gates. Expected findings: G0, G6, G7 for all six tasks (the F9 pair's G4 now passes at `09f6074b1`). Any other finding is a regression. The telemetry auditor must report `PASS: 0 finding(s)` for all six. The reference and negative-control outputs are in each task's `evidence/` directory; inspect the counts and per-case statuses rather than only process exit codes.

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

| Gate               | F9 pair                                                                                                                                                                                                                   | F6 pair                                                            | F4 pair                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| G0 construct       | Pending formal current independent approval; prior design review is historical evidence                                                                                                                                   | Same                                                               | Same                                                               |
| G1 reference       | Pass: 60/60 offense, 180/180 defense                                                                                                                                                                                      | Pass: 60/60 offense, 180/180 defense                               | Pass: 80/80 offense; defense 512 grants, precision/recall 1        |
| G2 security/oracle | Pass in the declared staged context; malformed-ledger controls and telemetry audit checked                                                                                                                                | Pass in the declared staged context                                | Pass in the declared staged context                                |
| G3 shortcuts       | Pass for declared model-free baselines and mutations                                                                                                                                                                      | Pass for declared model-free baselines and mutations               | Pass, including position baseline after grant-order randomization  |
| G4 pairing         | **Pass** (F9 @ `09f6074b1`): both paired live incidents (malicious + full-rotation benign) initialize from the immutable capture — native inventory + v1/v2 auth probes — and pass response replay; twin conformance true | Pass for frozen corpus conformance, 180/180 cases                  | Pass for frozen corpus conformance, 64/64 populations              |
| G5 operations      | Pass for declared deterministic simulation and model-free workflow                                                                                                                                                        | Pass for declared deterministic simulation and model-free workflow | Pass for declared deterministic simulation and model-free workflow |

G2 and G5 cover the portable in-memory estates and their declared failure states. They do not establish host isolation of a later model runner, resilience to unmodeled provider faults, or fidelity to a particular cloud or identity product. G6 model calibration and G7 claim approval remain pending for every task. No achieved evidence level or deployment conclusion is claimed.

The F9 G4 blocker is **resolved** at `09f6074b1`: the responder now initializes its live state from the immutable capture via `buildIncidentFromCapture` — it reconstructs each consumer's inventory, migration state, and accept/revoke facts from the producer's native `consumer.inventory` events and `rotation-audit` v1/v2 probes (never from seed), and both paired incidents (malicious stale-access + full-rotation benign) pass response replay. A prior estate bug (`consumerAccepts` tested `role === 'live'` but the roster has two live readers `live`/`live-2`, so `live-2` falsely read as an outage) is fixed with `role.startsWith('live')`.
