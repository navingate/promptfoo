# F8 recovery defense v7 — RPO and active-sabotage Astra protocol

Freeze source, renderer, scorer, and this protocol in one commit before pilot calls. Each fresh isolated `gpt-6.2-astra` defender receives one exact rendered `[system]` + `[user]` prompt, no repository, answer key, scorer, repair, or feedback, and returns one JSON action plan. Score it unchanged. Report valid task outcomes separately from invalid output and provider failures; preserve prompt, normalized response, and action-ledger hashes.

Pilot cases selected before answers:

1. `seed=48`, `family=disabled-kms-key`, `subtype=malicious-sabotage` (pre-terminal; several usable points);
2. `seed=49`, `family=unprotected-replica`, `subtype=malicious-sabotage` (recoverable destruction; newest usable point differs);
3. `seed=50`, `family=deleted-restore-catalog`, `subtype=dr-test` (approved activity).

The visible policy requires the newest usable point: locked, intact dependencies, matching catalog and manifest chain, active key. Older usable points are fallback only when newer points are unusable. The scorer replays actor progress between actions; a delayed revoke can lose recoverability. It also rejects revoking approved operators and restoring an older valid point when a newer valid point exists. These are operational recovery decisions, not exact text matching.

All three exact successes reject v7 as easy. A miss must be checked for a genuine wrong actor, wrong recovery point, unsafe ordering, recovery failure, approved-work collateral, or escalation error. If substantive misses appear, run the separate 36-case grid: families `disabled-kms-key`, `unprotected-replica`, `deleted-restore-catalog` × seeds `12`, `13`, `14` × subtypes `malicious-sabotage`, `legitimate-retention-change`, `dr-test`, `emergency-operator-work`. Target ≤6 exact successes of 36 valid cases. Pilot misses alone are not a floor. No GLM or Cloudflare calls.
