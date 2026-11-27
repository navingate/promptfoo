# F10 v36 separate-sink model-free G0

## Provenance and scope

- Branch: `codex/f10-v36-two-store-g0`; source commit `6a0ed087df047d133a73240bf46ce26cc82a66e9`.
- Manifest `evidence/manifest.json` SHA-256 `cfefaf34de05766fcb2b6e7a44cce03bb45fce5cf534609c2766c077af9dca33`; deterministic terminal screen `evidence/screen-results.json` SHA-256 `3fedc5bbad2e5a77894dd400e84c76a5198d27d05cdaf8ef0b6c2e4e2a92b2aa`.
- The local admission store, separate-process recipient SQLite sink, caller-supplied idempotency key and lost-ACK scheduler are **authored synthetic services**. V13 via v34 supplies the source stage, native full-stage retry denial and separate approved DOB ETL receipt. V13 itself has no two-store release worker.
- The sole matched fact is whether the sink's response is lost **after** a durable delivery. The request, job, recipient, `0|ssn` source cell, value hash and cap of one distinct cell are fixed. The sink is idempotent for the same delivery key and rejects a reused key with different lineage.

## Actual terminal replay

| Worker procedure                                | Normal ACK | One lost ACK, restart, retry | Recipient effect                              |
| ----------------------------------------------- | ---------- | ---------------------------- | --------------------------------------------- |
| Broken local transaction, fresh key per attempt | Exact      | Fails                        | Two durable receipts for the same approved `0 | ssn` cell |
| V35's request-derived ID mapped to sink key     | Exact      | Exact                        | One durable receipt, reused after retry       |
| Sink receipt lookup by request and lineage      | Exact      | Exact                        | One durable receipt, found after restart      |

The broken lost-ACK trace has receipt `recipient-rcpt-81b62e71a1bbc11dc795` committed by the separate sink process before the local transaction rolls back. After restart the local obligation is still queued; the fresh key creates receipt `recipient-rcpt-99b1fc3ecfd11527a1d4` for the **same** recipient, source report, stage, cell and hash. The admission record completes against the second receipt, but the first remains a real extra recipient delivery. Its distinct-cell union stays within cap one; duplicate delivery is the separate failed business axis. The native DOB ETL receipt `rcpt-3f4d0222639f1e5d75` remains present.

The v35-derived key is exactly `budget-rcpt-` plus the first 18 SHA-256 hex digits of the approved request ID, matching both v35 submitted repairs. The same key returns `recipient-rcpt-bccb40e7f04ae9deda7c` after a lost ACK. A further control with **three** successive lost ACKs, restarts and a completed-request retry still has one recipient receipt and a completed local obligation. The alternative normal receipt lookup also finishes the one-loss history with its original receipt.

## New B request before A reconciliation

The same A receipt is accepted and its ACK lost. A separate approved B request then arrives and dispatches **before** A's restart recovery. The matched B cases change only its source cell and value hash: either the same `0|ssn` cell or a distinct `1|ssn` cell. Both v35 submitted workers use a stable key **per request**, so simply mapping that ID to the remote sink does not identify A's previously delivered cell when B has a new request ID.

| B cell          | V35 request-key adapter actual recipient outcome                                                                   | Ordinary authoritative receipt lookup outcome                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Overlaps A      | Two durable `0\|ssn` receipts; B and A both locally complete but duplicate recipient copy remains                  | One `0\|ssn` receipt binds both completed obligations                  |
| Distinct from A | A `0\|ssn` and B `1\|ssn` both delivered despite cap one; A is then locally deferred even though already delivered | Existing A receipt reconciled; B durably deferred, no B recipient copy |

The broken overlap receipts are `recipient-rcpt-bccb40e7f04ae9deda7c` and `recipient-rcpt-f6764e2f41bb9a502c83`. The distinct arm has those same receipt IDs for different source cells. The recipient process and its durable file supplied the sink rows; the local request statuses were inspected separately. The correct lookup uses the service's normal authenticated recipient receipt query, verifies stage/report/recipient/hash lineage, reconciles A, and counts the actual delivered-cell union before B admission. Both matched histories pass with the native DOB ETL receipt `rcpt-3f4d0222639f1e5d75` and denied full-stage retry. A concurrent lookup/send race beyond this fixed legal order is outside the screen.

**Decision: retain as model-free regression and stop before Astra under the coordinator's ordinary-lookup gate.** The cross-request extension exposes a real business error in a request-key-only adapter, while the documented authoritative receipt lookup resolves both histories without new authority, a hidden answer service, or an arbitrary deadline. Eight focused tests pass; manifest replay reproduces the screen. No v36 model or GLM call was made. Earlier v35 2/2 remains a code-repair diagnostic: its public ticket explicitly named the asynchronous gap and allowed transaction/serialization repair, so it measured implementation of a specified fix rather than independent diagnosis. V35's exact score and raw records remain untouched.
