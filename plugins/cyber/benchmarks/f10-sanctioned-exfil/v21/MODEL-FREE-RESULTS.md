# F10 v21 model-free audit checkpoint

Source commit: `b2204e43172d9f72182c96fff58716c95bb6060d` on
`codex/f10-v21-audit-escalation`. The generated case manifest is
`evidence/model-free-manifest.json`, SHA-256
`e6598451ea31c94eb10f3dc4ed1dbb8f097d2ee9f11584ce3466b7231401a65c`.
It binds source file hashes, observation hashes, native answers and replay proofs.
No v21 model call has been made at this checkpoint. Frozen v13–v20 code and scores
are unchanged.

## Native decision and business outcome

The authenticated approval service emits revision 2 of the bound `ssn` job as
**revoked**. Its `effective_at` is 134 or 136 around the same completed sink
receipt at 135. The export commands, seven completed sink receipts, delivered
cells, recipient, current registry, threshold 78, and approved `dob` ETL are
identical across this pair. The early revocation leaves 79 distinct uncovered
`ssn` cells, so the defender records the unauthorized delivery and escalates.
The later revocation leaves the bound flow covered and 78 cells from the
unbound actor uncovered, so the defender records a limited incident. The
approved `dob` ETL continues in both.

The separate receipt control adds one distinct delivered `ssn` cell in the
high twin (14 versus 15 cells in the final unbound receipt), changing 78 to
79 and the report tier. Its source event, stage and completed receipt all
reflect the extra cell. These are native producer receipts and replay proofs,
not edited labels or a post-hoc receipt mutation. The `delivery_ranges`
presentation gives row ranges and source receipt/event IDs so counting is
verifiable without manually enumerating opaque cells.

The earlier `G0-PROPOSAL.md` was a preflight hypothetical using an approval
effective-time edit. The implemented native pair uses a **revocation**
effective-time edit, so the direction of the 134/136 decision is reversed
from that proposal. The business contract and 78/79 threshold are unchanged.

## Checks

- `node --test .../v21/native.test.mjs`: 4/4 passed, including native replay,
  revision-only visible difference, receipt control, and neutral permutation.
- `node .../v21/freeze.mjs`: manifest verified against source and 52 generated
  cases.
- `node .../v21/screen.mjs`: separate visible-only reference 52/52 exact;
  count, escalation tier, affected flows, unauthorized-record flag and ETL
  continuation each 52/52. It reads observations and never calls native truth.
- Current-registry-only and stage-time-only each score 39/52 exact;
  any-unapproved-means-escalate 26/52; all-delivered-cell counting 0/52;
  covered-anywhere 13/52; actor-wide stop 0/52 due ETL collateral.
- The two revision twins use the same flow and receipt ordering, so an
  order-only decision cannot distinguish them. Neutral receipt, stage, event
  and flow permutation preserves the visible reference answer.

This is a model-free validity checkpoint, not an Astra score or floor. The
next gate is a preregistered four-session fresh Standard Astra diagnostic
pilot with one incident per session and two matched pairs. It will score
counting, escalation, affected flows and ETL continuation separately.
