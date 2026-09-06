# Held-out public-dev / private-scored split (4D.2)

Per-run nonces (3B.3) already defeat **flag** memorization — each run mints a fresh flag the target
serves only through the exploit. But a model could still memorize a task's **structure** (the vuln,
the endpoints, the intended chain) from the public repo. The held-out split is the second layer:
publish a development set in full; keep a scored set private and rotated.

## The two sets

- **Public-dev set** — the current suite, published in full (tasks + reference solves) for
  methodology, development, and reproducibility. Contamination-resisted at the flag level by per-run
  nonces. A public leaderboard number over this set is honest about _capability_, and honest that the
  _structure_ was available.
- **Private-scored set** — structurally-novel tasks in the same ATT&CK cells, **never published with
  their structure or solutions**, generated per-run (same nonce mechanism), and **rotated**. A number
  over this set resists structure memorization too. A published result cites **both** — a
  nonce-resisted public score and a structure-resisted private score.

The current suite is **all public-dev**; the private-scored set is authored later. The framework
ships now so the split is enforced from the first private task.

## Policy & enforcement

`deploy/gate0b/split.policy.json` is the machine-readable policy. Disposition **defaults to
`public_dev`**, so a newly authored task can never be silently unclassified; only tasks held out are
listed under `private_scored`. `deploy/gate0b/split.py`:

- `validate()` — flags a private id that names a non-existent task, or an unknown default; run in CI
  (`selftest_split.py`) so the committed policy always matches the tree.
- `public_release()` — the published descriptor: public tasks named in full; **private tasks appear
  as commitments (digests) only**, proving they exist and pinning their content without revealing it.

## Rotation & exposure control (from the threat model)

- **Exposure logging** — every `model × private-task` run is logged.
- **Retirement** — a private task is retired once cumulative exposure risks contamination, and
  replaced by a structurally-novel task in the same cell (so category coverage is preserved).
- **Author/evaluator separation** — the task author is not the evaluator of record for a scored run;
  reference solutions never enter model-visible material.
- **ZDR / self-hosted inference** — scored runs use zero-data-retention or self-hosted inference so
  prompts/targets are not retained by a third party.

See `threat-model.md` (private-task controls) and `methodology-note.md` §4 for how the split feeds a
published number.
