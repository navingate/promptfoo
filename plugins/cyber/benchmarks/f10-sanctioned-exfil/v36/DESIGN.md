# F10 v36 separate-recipient-sink feasibility

This is one **model-free** synthetic G0. V13 has a synchronous native publisher
and no two-store worker. V34/V35 introduced an authored one-file SQLite
admission and sink; this extension moves the recipient delivery to a separate
SQLite file owned by a separate Node process. The native v13 source stage,
denied full-stage retry and approved DOB ETL are replayed through v34 and
reported separately.

The approved job permits one distinct protected cell to the named recipient.
The recipient sink is ordinarily idempotent by a caller-supplied delivery key:
repeating one key with identical cell lineage returns its original receipt;
reusing it for different content is rejected. A different key is a different
delivery, even if its cell is identical. The worker has a normal lookup path
through this sink and can choose a stable key. Admission and recipient delivery
cannot share a SQLite transaction.

One matched request is replayed with either a normal acknowledgement or the
sink committing the receipt and exiting before its acknowledgement reaches the
worker. In the lost-ACK arm, the worker's local transaction rolls back and a
new worker process/connection retries the still-queued request. Only the ACK
outcome changes; job, recipient, stage, report, cell, policy and ETL are fixed.

The deliberately broken adapter protects only the local transaction and uses
a new per-attempt delivery key after restart. It therefore creates a second
recipient receipt for the same cell. One ordinary reference maps v35's exact
request-derived receipt ID to the remote idempotency key; the sink returns the
first receipt and the admission record completes. Another uses the sink's
normal receipt lookup after restart. The terminal scorer checks the
actual recipient file, approved obligation state, duplicate cell copies,
capacity, source/recipient lineage and native DOB ETL. There is no deadline.

**Scope limit:** v35's submitted repair derived a stable local receipt ID from
the request ID. Mapping that ID to the new sink's idempotency key is a sound
ordinary solution. This G0 tests whether a local transaction **alone** can
cover the new durable boundary; it does not show that the unchanged v35 repair
would make a new attempt key if correctly adapted to the external API. The
ordinary stable-key solution is a baseline, not evidence of Astra difficulty.

## Cross-request continuation

The same separate sink is then tested after A's approved `0|ssn` cell is
durably accepted and its ACK lost. Before A is reconciled, a distinct approved
request B arrives and is processed first. The matched B cases differ only in
its source cell and value hash: B asks for A's same cell, or for `1|ssn` under
the one-distinct-cell cap. A then retries after worker restart. This is a legal
service order, not a wall-clock race or deadline. The previously accepted A
copy remains a recipient receipt even while the local request still says
queued.

Both actual v35 submitted workers use a stable **per-request** receipt ID.
The baseline external adapter sends that ID to the remote sink but checks
only the local receipt shadow. B's different request ID therefore creates a
second recipient copy in the overlap arm; in the distinct arm it releases B,
exceeds the cap and later defers the already-delivered A obligation. The
ordinary alternative queries the authenticated recipient ledger before B
admission and after restart: it binds overlapping B to A's existing receipt,
or defers distinct B, then reconciles A. The normal lookup is already in the
service interface and needs no new authority or hidden truth flag. This
reference solves the bounded pair. A general concurrent deployment would
also need serialization or reservation around the lookup/send gap; that
additional schedule is not scored here.
