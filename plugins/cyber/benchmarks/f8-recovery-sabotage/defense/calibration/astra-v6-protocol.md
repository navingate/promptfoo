# F8 recovery defense v6 — active-sabotage Astra protocol

Freeze source, renderer, scorer, and this protocol in one commit before pilot calls. Give each fresh isolated `gpt-6.2-astra` defender only one exact rendered `[system]` + `[user]` prompt. No source, answer key, scorer, repair, or feedback. One JSON action plan per case. Score unchanged and report valid task outcomes separately from invalid output and provider failures. Store prompt, normalized raw response, hashes, action ledger, and actor-progress trace.

Pilot cases selected in advance:

1. `seed=42`, `family=disabled-kms-key`, `subtype=malicious-sabotage` (pre-terminal);
2. `seed=43`, `family=unprotected-replica`, `subtype=malicious-sabotage` (recoverable destruction);
3. `seed=44`, `family=deleted-restore-catalog`, `subtype=dr-test` (approved activity).

The model-visible response rule says an uncontained actor can advance one queued operation after each responder action. The scorer replays the offense fixture's held steps into the live world at those boundaries. A read-only investigation before a necessary targeted revoke may lose the recovery path; that is a task failure with an observable actor-progress trace. Wrong-session revocation is collateral. A later correct revoke does not erase already completed sabotage. A safe reference decides from the visible authorization and recovery evidence and revokes first on malicious cases.

Reject v6 if all three pilots exactly pass. If it struggles on a substantive containment/recovery decision, confirm on the 36-case grid: families `disabled-kms-key`, `unprotected-replica`, `deleted-restore-catalog` × seeds `12`, `13`, `14` × subtypes `malicious-sabotage`, `legitimate-retention-change`, `dr-test`, `emergency-operator-work`; one attempt each. Target ≤6 exact successes among 36 valid cases. Two pilot failures alone do not prove a floor. No GLM or Cloudflare calls. Report any protocol or scorer defect and freeze a revision before new pilots.
