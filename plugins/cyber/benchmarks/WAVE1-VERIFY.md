# Wave 1 model-free verification

Run from the repository root with the version in `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use`).

Wave 1 is three paired families — `f9-secret-rotation`, `f6-poisoned-change` (v2), `f4-durable-consent`
(v3) — each with `offense` and `defense` tasks. Each family's evidence is bound to its own implementation
commit (the metadata/evidence sits in a follow-up commit; the auditor verifies working-tree bytes against
the labelled commit):

| Family | Audit `--commit`                           |
| ------ | ------------------------------------------ |
| F9     | `0d33c7cd8c30b9119db43d59965509dd6b3300b4` |
| F6     | `49d6c900eaaa7ca074e02cbcb44ad0f2311353da` |
| F4     | `9cdd6719b8e662a1e57ed1744e4893467436f98a` |

```bash
node --test plugins/cyber/benchmarks/_tooling/wave1-regression.test.mjs   # 5/5 pass

A=.agents/skills/cyber-benchmark-authoring/scripts
declare -A C=( [f9-secret-rotation]=0d33c7cd8c30b9119db43d59965509dd6b3300b4 \
              [f6-poisoned-change]=49d6c900eaaa7ca074e02cbcb44ad0f2311353da \
              [f4-durable-consent]=9cdd6719b8e662a1e57ed1744e4893467436f98a )
for family in "${!C[@]}"; do
  for mode in offense defense; do
    task="plugins/cyber/benchmarks/$family/$mode"
    node "$A/audit_benchmark.mjs" --repo-root . --task "$task" --commit "${C[$family]}"
    node "$A/audit_telemetry_contract.mjs" --repo-root . --task "$task" --commit "${C[$family]}"
  done
done
```

The benchmark auditor exits nonzero for intentionally pending gates (that is expected — see the matrix).
Any finding **other** than `MODE_GATE_REQUIRED` on a pending gate is a regression. The telemetry auditor must
report `PASS: 0 finding(s)` for all six tasks.

## Gate status (auditor-verified)

G0 is **bound** as an author-issued carry-forward of the independent AI construct review
(`reviewer_id: openai-codex-gpt-6`, approved @ design commit `43c437f8c`, G0 scope only), accepted by the
owner (2026-10-07). Each task's `evidence/approval-g0-construct.yml` records the provenance; the
construct-defining docs are byte-identical to `43c437f8c` (a fail-closed empty-diff guard enforces this at
bind time). Achieved evidence level is **0** for every task (level 1 needs the full reviewer chain,
including the **human** claim reviewer at G7).

| Task       | Passing gates     | Pending gates  | Why pending                                                                                                                                                                                                                                |
| ---------- | ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| f9 offense | G0 G1 G2 G3 G4 G5 | G6, G7         | G6 = local calibration only (frontier ceiling run not yet done); G7 = human release review                                                                                                                                                 |
| f9 defense | G0 G1 G2 G3 G4 G5 | G6, G7         | same                                                                                                                                                                                                                                       |
| f6 offense | G0 G2 G3 G4 G5    | G1, G6, G7     | G1 needs the pinned prose-reading LLM victim (a G6 artifact) — by design; G6/G7 as above                                                                                                                                                   |
| f6 defense | G0 G1 G2 G3 G4 G5 | G6, G7         | G6/G7 as above                                                                                                                                                                                                                             |
| f4 offense | G0 G1 G2 G3 G4 G5 | G6, G7         | G6/G7 as above                                                                                                                                                                                                                             |
| f4 defense | G1 G2 G3 G4 G5    | **G0**, G6, G7 | G0 pending: `defense/label-policy.md` + `scoring-contract.md` carry a post-approval semantic change (the `ambiguous` decision procedure) to files the reviewer confirmed reading, so they need the reviewer's re-read before carry-forward |

## Reference / shortcut evidence (per task `evidence/`)

- F9: offense reference 18/18 declared scored instances; defense reference across subtypes; shortcuts fail.
- F6: offense reference 60/60 (scripted-stub plumbing — the real score needs the G6 victim); negative
  mutations reach the correct stage; 5 shortcuts compute `solves_construct: false`; G2 read-path 120/120;
  defense reference 180/180 useful-refusal; twin conformance 180/180.
- F4: offense reference 64/64; 6 negative mutations stop for the intended reason; decision space has no
  fixed position/facet tell; defense reference joiner reproduces the evaluator key 64/64 (independent
  re-implementation; a divergence test confirms non-tautology); shortcuts fail; coverage spans all 6
  classes + the 7 counterexamples + 4 distractors; twin conformance 64/64.

## Regeneration

Regeneration is deterministic and writes files. Run producer then consumer, then bind both to the family's
commit (a 2-pass generate→bind→generate→bind settles the de-oracle staged-context inventory). Compare
contents and SHA-256 values before committing.

## Limits / hand-backs

Not performed here (require the user, the VM + keys, or a human reviewer): G6 frontier ceiling runs (cost),
F6/F4 local G6 calibration (VM-dependent), G7 claim/release review (**human or independent-org** reviewer
required — an AI review is not sufficient for release), and the F4-defense G0 reviewer re-read.
