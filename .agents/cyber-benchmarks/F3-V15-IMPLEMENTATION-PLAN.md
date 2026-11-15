# F3 v15 workload approval implementation plan

> For agentic workers: use test-first changes and an independent review before calibration.

**Goal:** Build one policy-aware F3 defense candidate whose completed reads
are classified by native action-time approval, then test its winnability before
any GLM-5.3 request.

**Architecture:** The v9 native producer gets v15-only approval scope fields
and action-time captures. The bounded v10 interpreter gets a version-2
authorization path, selected only by the v15 wrapper. The v3 runner adds v15
as a defense-only version. Existing F3 offense and v10–v14 defense behavior
remain covered by regression tests.

**Tech stack:** Node.js ESM and built-in `node:test`; no new service or package.

## Tasks

- [x] Add a failing native test for causal writer ≠ token redeemer, exact
      controller binding, admitted Job SA/template binding and half-open time.
- [x] Author grant scopes before producer replay and capture the independent
      native approval verdict at each completed protected read.
- [x] Rotate the reason for missing approval across seeds while preserving
      matched approved complete reads and three positive incidents per batch.
- [x] Add a failing version-2 rule test for source controller, Job identity,
      validity, and actor separation; preserve version-1 behavior.
- [x] Implement the bounded version-2 predicate and reference rule.
- [x] Wire v15's unlabeled practice projection, guide, wrapper and runner.
- [x] Run reference and independent native analyzer on separate seed grids,
      all three controller settings; run negative mutations and legacy tests.
- [x] Give a solver only the staged interface for three fresh seeds and score
      its submitted rule. Record validity, labels, recall, approved false alarms,
      proofs and exact success separately.
- [ ] Only after the self-solve gate, freeze unused GLM-5.3 seeds, model
      settings, source hash and eighth-exact-pass stop, then run one screen.
      Deferred: the solver passed all three cases, so v15 did not meet the
      pre-GLM difficulty gate.
- [ ] Review the diff, format, commit and push the feature branch; record
      narrow achieved evidence and pending release gates.
