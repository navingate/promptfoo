# F10 v18 pilot trace analysis

The two frozen valid responses in [PILOT-RESULTS.md](PILOT-RESULTS.md) are
exact: 2/2 batches and 16/16 labels, with all eight sanctioned ETL flows
preserved. Each raw CLI event log has only a completed `agent_message` between
turn start and completion. There is no reasoning or tool trace. Consequently,
the records establish what Astra answered, **not which evidence it used**.

The pilot interface has a deterministic presentation cue. Both seeds show
four captures in the same order: approval before, approval after, revocation
before, revocation after. Within every capture the primary flow is first and
the sanctioned ETL flow second. A rule that ignores the ledger and receipts,
assigns primary labels `sanctioned-bulk, cumulative-exfil,
cumulative-exfil, sanctioned-bulk` by capture position, and assigns every
second flow `sanctioned-bulk` reproduces **2/2 exact and 16/16 labels** under
the frozen strict grader. This is a model-free shortcut demonstration, not
evidence that Astra used the shortcut. Current-registry, stage-time, and
alarm-all shortcuts failed the pilot screen, but the positional shortcut
shows that screen was incomplete.

The two cases also have no below-threshold unapproved protected flow and no
ambiguous flow. They demonstrate correct responses to four temporal contrasts
and benign ETL in two fresh sessions, not broad authorization reasoning. A
successor must put one incident in each model session, avoid positional label
templates across seeds, and test the interaction among completed receipts,
per-delivery coverage, and distinct uncovered cells against matched business
outcomes. The original v18 result and raw records remain unchanged.
