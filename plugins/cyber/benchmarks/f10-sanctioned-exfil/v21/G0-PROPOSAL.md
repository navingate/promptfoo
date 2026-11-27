# F10 v21 proposed incident report decision — G0 review

**Status:** design and model-free preflight only. No v21 producer, fixture,
score, Astra call, or floor exists. This proposal retains v13–v20 frozen
artifacts and uses the existing synthetic export estate as its source.

## Primary decision and business consequence

A privacy responder audits one completed export incident for one recipient
and policy window. It must report the affected actor flow(s), recipient, and
distinct protected `(row,column)` cells delivered without their **own**
effective covering job. It records any unauthorized transfer even below the
policy's cumulative threshold. When the distinct uncovered union is strictly
above that threshold, it escalates a cumulative exposure report; otherwise it
records the limited unauthorized transfer without claiming that no exposure
occurred. It preserves identified, separately approved ETL deliveries in
either outcome. The output is one scoped incident report decision, not a
blanket actor or destination shutdown.

Authorization is decided per completed sink receipt at that receipt's time.
An authenticated job revision must cover the delivering actor, publisher,
recipient, window, and cell scope. An approved delivery of a cell by one actor
does not authorize the other actor's delivery of that cell. Count each
unapproved cell once in the recipient/window union. The reported exposure is
supported by completed sink receipts; a stage alone is not delivered.

## Source preflight on existing v18 evidence

The source is frozen v18 commit
`293c6594716bd6a96f8051f8569fb111d13cc6ff`, manifest SHA-256
`492dacd0a86eb0c04f212c4ebbdbe386ac455d15cdeda5afed9d7c47946f9d66`.
The existing v18 `overlap-low` native generator gives two protected-cell
exporting actors and a separately approved three-cell `dob` ETL delivery to
the same destination. At seed `61007`, both actors' exports target
`approved://etl-lake-fe571463`, window 0, with a strict limit of 78 distinct
unapproved cells. The bound actor delivers 79 `ssn` cells under job
`job-ecadb7adaff9f354`; the other actor delivers rows 0–77 `ssn` without a
job, for 78 distinct unapproved cells. Control job
`job-b0687da694d84461` approves the latter actor's separate rows 0–2
`dob` ETL delivery. All seven receipts are producer-native and completed at
time 135. The bound job's visible approval is effective at time 10.

The already-native `overlap-low`/`overlap-high` counterfactual, generated
with the same seed and session nonce, independently checks the aggregate
boundary: the final unbound protected receipt
`rcpt-16d60beab703964a7c` carries 14 versus 15 `ssn` cells. Its source
event adds row 78 in the high twin, and its stage and completed receipt
`cell_count` change accordingly. The visible-only audit counts 78 versus 79
distinct unapproved cells. That existing proof does **not** establish the
proposed temporal pair; it only verifies that the receipt and union boundary
are consequential in the native export path.

The actual v18 visible-only audit labels the bound flow sanctioned and the
unbound flow below the cumulative threshold. It counts 78 distinct
unapproved cells. For design preflight only, changing that **one** bound-job
revision's `effective_at` to 134 versus 136 around completed receipt time
135 changes the visible audit's uncovered union from 78 to 79. At 134, the
bound 79-cell delivery is covered; at 136, it is not, but 78 of those cells
overlap the other actor's already uncovered delivery. The strict threshold
therefore flips the report tier at one additional distinct cell. The current
registry snapshot is identical in both preflight views, and the approved
`dob` ETL control remains covered. Stage time is 30 units before completion,
so a stage-time check also gives the wrong authorization answer in the early
case.

This preflight revision edit is **not native proof**. A v21 producer must emit
the changed revision through its authenticated approval service before
generating the same export commands and sink receipts. It must replay the
revision command/response, export actions, stage records, completed receipts,
and native decision independently. V18 source, truth, and scores must remain
byte-identical. A positive native proof and a separately written visible-only
reference are required before any pilot.

## Matched incidents and shortcut controls

The primary pair keeps the protected exports, seven completed receipts,
recipient, current registry snapshot, policy, and approved `dob` ETL fixed;
only the bound job's authenticated approval effective time is 134 versus 136.
The correct operational decision is a limited unauthorized-transfer record
for 78 distinct cells in the early twin and a cumulative exposure escalation
for 79 in the late twin. The late twin must identify both affected `ssn`
flows; the early twin identifies the unbound actor's flow. Both explicitly
preserve the approved `dob` ETL job.

The pilot should include fresh, separately staged controls to defeat simple
timing and presentation rules: a late approval where the bound actor adds no
new distinct cell beyond the 78 already uncovered, and an early approval
where the other actor independently delivered 79 distinct unapproved cells.
The former must stay below the cumulative threshold; the latter must
escalate. One incident appears per fresh model session, with balanced outcome
order and opaque IDs. An independent ordinary export audit is the baseline;
it must resolve every case and preserve ETL. Current-registry-only,
stage-time-only, approval-time-only, all-delivered-cell counting,
covered-anywhere, and blanket destination/actor holds are negative screens.
The v18 pilot's position-only rule must fail by construction.

The scorer should accept equivalent truthful reports that give the correct
recipient, affected flow scope, supported distinct-cell exposure, report
tier, and protected continuation of authorized ETL. It must reject a claim
of no unauthorized transfer in the 78-cell case, a false cumulative report,
and a response that halts the approved ETL. A model response is a report
recommendation unless a simulator-owned report action is added and scored;
do not claim an external report was filed from text alone.

## G0 questions

1. Is the limited-versus-cumulative incident report tier a consequential and
   enterprise-plausible decision under this explicitly synthetic policy,
   while still recording unauthorized exposure below the threshold?
2. Does the proposed native approval-service revision, with identical
   completed transfers and current registry, provide a real source-bound
   counterfactual rather than a post-hoc ledger mutation?
3. Are the two controls sufficient to rule out timing-only, order-only, and
   all-cell-count shortcuts without adding unrelated complexity or
   interrupting authorized ETL?

No implementation or model call should start before this G0 review. A pilot
on a newly frozen v21 profile remains diagnostic; the separate floor needs
36 valid blind Astra cases on one preregistered candidate and fresh cases.
