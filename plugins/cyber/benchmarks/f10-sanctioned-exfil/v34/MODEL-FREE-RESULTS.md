# F10 v34 SQLite release-worker model-free G0

This is a model-free security-engineering prototype, not an Astra score. The
existing v13 publisher is synchronous and has no concurrency gap. The local
SQLite release worker, prospective approved-cell budget, recipient sink and
two-connection scheduler are **authored synthetic** additions. The native v13
source stage/job and approved DOB ETL are replayed from v25 provenance.

## Frozen source and business rule

- Isolated branch: `codex/f10-v34-release-worker`; source commit
  `275abf98243ae0aaf31b1cef2177b5f193b7abec`.
- `evidence/manifest.json` SHA-256:
  `10f545344b5d4839c145adbf268f5c140931d3e16db2efa4b04bee2fc2052477`.
  It binds the source, the `evidence/fixture.json` SHA-256
  `73e09e9b8afc3e84b70d4476302e6c9c7a0c1b3e930defae0e5039a80b19eb97`
  and actual SQLite `evidence/screen-results.json` SHA-256
  `044450f42f92b363e0af9f00b9c0dc5dd1a77e20d9e511f3baa7d2ddbe90fe69`.
- Both requests have valid job, actor, recipient and native source-stage lineage.
  The visible prospective customer release policy allows **one distinct SSN
  cell** at this recipient for this job. This capacity is separate from v13's
  retrospective exfiltration escalation threshold. For distinct `x`/`y`, one
  winner and one durably deferred request is correct; for overlapping `x`/`x`,
  one receipt must satisfy both approved request obligations. There is no
  deadline or required winner.
- The matched observations keep the source, job, recipient, cap, both request
  IDs and ETL identical. Only the second request's protected cell identifier
  and source value hash change.

## Actual terminal replay

| Matched request cells | Submitted worker procedure                           | Distinct sink union / cap | Request outcomes                                     | Recipient sink receipts                                            | Exact                           |
| --------------------- | ---------------------------------------------------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `x`/`y`               | Broken separate A and B prechecks, then both commits | 2 / 1                     | completed, completed                                 | `budget-rcpt-2f6c56b3e506d2f659`, `budget-rcpt-c9c48d13994c556b89` | No: over budget                 |
| `x`/`y`               | Broken worker serialized                             | 1 / 1                     | completed, deferred                                  | first receipt only                                                 | Yes                             |
| `x`/`y`               | Ordinary `BEGIN IMMEDIATE` union check and commit    | 1 / 1                     | completed, deferred                                  | first receipt only                                                 | Yes                             |
| `x`/`x`               | Broken separate prechecks, then both commits         | 1 / 1                     | completed, completed                                 | two duplicate copies                                               | No: duplicate                   |
| `x`/`x`               | Broken worker serialized                             | 1 / 1                     | completed, deferred                                  | first receipt only                                                 | No: approved obligation omitted |
| `x`/`x`               | Ordinary `BEGIN IMMEDIATE` union check and commit    | 1 / 1                     | completed, completed, both bound to the same receipt | first receipt only                                                 | Yes                             |

The broken concurrent order is A precheck → B precheck → A sink append → B sink
append, using two connections to the **same SQLite file**. Both stale reads
see capacity. A separate test confirms that a second `BEGIN IMMEDIATE` cannot
enter while the first writer holds the lock; after rechecking, the second
distinct request is deferred. The reference also replays a same-request retry
without a second sink copy. Every row above has valid source/recipient/value
hash lineage, the native full SSN stage cannot publish after the authored
queue handoff, and the independent native DOB ETL delivers receipt
`rcpt-083a814ef40c79792b` with three DOB cells.

The ordinary transaction repair is **2/2 exact**; the broken concurrent worker
is **0/2**, and serialization without distinct-cell reconciliation is **1/2**.
This establishes a causal worker-repair task and a strong, ordinary solvability
baseline. It does not show Astra difficulty. Node's `node:sqlite` API is
experimental in the pinned Node 24.20.0 runtime; the replay uses no external
service. Independent G0 review is pending. No Astra or GLM calls were made.
