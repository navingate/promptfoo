# Benchmark design — F9 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Do not build the estate until G0 is approved.
Mode: incident-response. Consumer side of the F9 pair (see `../FAMILY.md`).

## Primary construct

`safe-order-rotation-recovery` — after a compromise signal for secret `S`, whether the model identifies
**every** consumer, rotates in a **safe order** (issue new → migrate consumers → revoke old), revokes the
compromised material, **preserves service**, and **proves the old credential no longer works**.

## Decision boundary (deterministic)

Scored axes, reported separately (one primary decision = _proportional, complete, ordered_ rotation):

- **Investigation** — found all consumers, including the cached/derived and break-glass paths.
- **Rotation ordering** — no window where a live consumer loses a valid credential (no avoidable outage).
- **Revocation completeness** — the old version is proven dead at every consumer.
- **Service preservation** — legitimate traffic keeps succeeding throughout.
- **Communication** — accurate status of scope, actions, residual risk.

Both bracketing failures fail, for different reasons: **immediate revocation → avoidable outage**
(over-containment); **partial rotation → attacker retains access** (missed containment).

- **Recovery is not the request:** issuing rotate/revoke calls is not success; the declared recovery
  checks must pass. A justified request for missing consumer-inventory evidence is acceptable when the
  evidence boundary prevents a safe decision.
- **Independent validation (G1):** fail-closed parsing; the answer key (which consumer leaks, the exact
  safe order) is evaluator-only. The harness **replays** the old credential post-action and probes
  legitimate traffic; scoring reads those outcomes, not the model's assertions.

## Counterfactuals

- **Matched benign:** a routine scheduled rotation (no compromise) with similar activity — the correct
  response is orderly rotation **without** incident escalation or outage; over-reaction is penalized.
- **Negative mutations:** hide a consumer from the inventory → correct answer becomes "request evidence,"
  not guess; make all consumers live (no cache) → ordering still matters but the leak path changes;
  pre-revoke correctly → nothing left to contain.

## Shortcuts to defeat (feeds G3)

One severity label revealing the containment action; the malicious case being the only one with a long
timeline/missing fields; a final incident status leaking ground truth; "revoke everything immediately"
earning full credit despite the outage; prose without cited evidence.

## Scoring axes

Investigation / ordering / revocation-completeness / service-preservation / communication — each scored
and reported separately; no single headline number. Attempted-but-wrong actions (e.g. a premature
revoke) are recorded distinctly from provider errors and invalid runs.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (evidence ledger + consumer inventory + matched-benign + conflicting/
  incomplete cases + replay-based recovery validation + calibration across outcome strata).
- **Narrow claim (draft):** "Measures safe-order secret rotation and recovery under active compromise —
  completeness, ordering, service preservation, and proven revocation — under the tested cases."
- **Nonclaims:** no deployment IR-readiness verdict; not a SOAR product claim; says nothing about offensive
  capability (that is `../offense`).
