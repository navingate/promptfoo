# F5 native capture intervention audit

Date: 2026-11-27 (Asia/Dubai). This is a bounded audit of the existing F5 offense capture, separate from the synthetic v10 data-recovery prototype and every Astra pilot. The producer capture is `offense/evidence/capture/f5-provenance-events-v1.jsonl`, SHA-256 `75855c0e6efbf752198d6c3b703a89c4170d48ae1b9c69862962f0d0ab4f54ee`. Its published twin-conformance record reports 210/210 conformant rows. No producer capture, scorer, or frozen candidate was changed.

## What the capture proves

The file has **210 scenario rows** across 10 seeds and three artifact families. Thirty matched-pair rows contain two artifacts each, yielding **240 artifacts** and 240 unique artifact digests. Each artifact has a valid signature, a protected-runtime deploy target, `protected_runtime_execution: true`, and a deployed outcome. The 30 matched pairs each contain one provenance break and one legitimate signed release. Across all artifacts, the evaluator labels are 60 breaks, 120 legitimate releases, and 60 ambiguous.

The artifact row links its digest to protected-runtime execution. It does **not** identify a currently serving workload, installation, service slot, customer cohort, or dependency of one workload on another. There is no response action interface or transition record. The 210 captures therefore support digest-scoped detection and impact triage, but cannot replay a decision to isolate or replace a particular workload, nor establish an outage avoided or caused by that decision.

## Ordinary visible-evidence procedure

I applied this release-incident procedure to each artifact using only its visible fields and `visible_world.release_policy`; `_evaluator` was used only afterward to verify the result:

1. If the resolved source, dependency list, builder, or a required attestation value is missing, or if the attestation contradicts the resolved chain, send the artifact for manual review.
2. Otherwise, compare the resolved source ref and digest, every dependency digest, and builder identity to the sanctioned policy. Continue a fully sanctioned release; scope an unsanctioned artifact digest for intervention and impact assessment.
3. Preserve a legitimate signed release even if it is new, emergency, or cache-reused. Do not treat signature or execution alone as proof of a provenance break.

This procedure made **240/240 correct artifact decisions**, including distinct actions for the break and the legitimate release in all **30/30 matched pairs**. A signature-only shortcut would nominate all 240 artifacts for intervention, including 180 that are legitimate or ambiguous. These are model-free decisions, not service continuity outcomes or Astra scores. The existing visible-only detector in `defense/scripts/harness.mjs` likewise matches the evaluator key for all 240 artifacts; its SHA-256 is `4db1896c0fff7fbb7e02198e246c7d01150a6352b6da2af3cfa3f4cf6e58bb5b`. The evaluator implementation in `shared/estate.mjs` has SHA-256 `6d2ebf122ddbad8425330ab3b4e22e3c3f7a302a648977870b103767f14b360c`.

## Screening decision

The proposed v11 decision needs native evidence connecting an affected artifact digest to a specific currently serving workload and an action surface that measures whether intervention harms legitimate service. This capture lacks both. The ordinary procedure resolves the available detection decision on every row. There is no defensible v11 pilot or F5 Astra-floor claim from these captures. Reopen only if the offense producer supplies a capture with the workload mapping and replayable action effects; keep the synthetic v10 regression and the frozen v9 pilot separate.
