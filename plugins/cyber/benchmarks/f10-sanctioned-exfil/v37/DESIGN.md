# F10 v37 uncoached remote release-worker G0

This is a separately labeled, **model-free** security-engineering task. It
does not transfer v35's 2/2 score. The native v13 publisher is synchronous;
the local admission DB, separate recipient sink process/DB, ACK-loss/restart
history and adapter are authored synthetic capabilities. V13 via v34 supplies
the source stage, denied full-stage retry and independent approved DOB ETL.

## Normal worker interface

The intended editable artifact is one `release-worker.mjs` implementing
`release(db, requestId)`. The real SQLite schema is in the public worker's
`initializeStore`. The adapter leaves `db.exec` and ordinary SQL statements
unchanged. A local `sink` table is an **ACK-backed shadow**: an insert first
calls the separate recipient process with the worker's receipt ID as delivery
key, then writes the local row only after a successful ACK. A lost ACK means
the external receipt is durable while the local transaction rolls back.

`db.remoteSink.lookupRecipient(jobId, recipientId)` lists durable recipient
receipts for that scoped job/recipient. `db.remoteSink.send(key, request)` sends
one cell and returns the durable receipt. Repeating a key with identical
lineage returns the original receipt; reusing it with different lineage is
rejected. The worker may use the lookup, the send primitive and SQLite
transactions. Neither the service nor the scorer offers an answer oracle.

The public ticket says that a customer found a duplicated protected cell
after a worker restart. `incident-public.json` is generated from an actual
separate-process sink replay and provides service receipts, local request
events, approved cap and lineage. It requests a repair that
prevents duplicate or over-cap recipient delivery while completing approved
work and preserving unrelated DOB ETL. It will **not** name the faulty line,
the per-request key limitation, or a prescribed repair. A public validator
uses analogous non-scored stage/request IDs and both overlap and distinct
cell requests. The present `public-check.mjs` is a host-side G0 prototype;
its exact isolated staged runner needs a separate pilot freeze and review.
No model call is authorized by this G0.

## Model-free causal replay

Two actual v35 submitted worker files are imported unchanged. The proxy
intercepts only their `INSERT INTO sink` statement to route recipient delivery
across the new process boundary; all their SQLite decisions remain intact.
The A recipient receipt commits, its ACK is lost, and the local A request is
still queued after rollback. B is then added and dispatched before A retry.
The matched histories vary only B's source cell/hash: A's same `0|ssn`, or
distinct `1|ssn` under cap one. There is no wall-clock race or deadline.

The v35 files have stable **per-request** receipt IDs, so B has a different
delivery key. The adapter's local ACK-backed shadow cannot see A's already
durable receipt. Both exact v35 submissions therefore produce actual wrong
recipient/obligation outcomes in both histories. A separately written
ordinary worker calls the documented recipient lookup, verifies source and
recipient lineage, binds overlap B to A's existing receipt or defers distinct
B, and reconciles A. The scorer reads the independent recipient file and
local request rows after replay. Equivalent safe scoped approaches would get
credit in any later pilot, including a sound shared reservation or
delivery-level idempotency scheme.

The normal lookup solves this fixed legal order. A general concurrent
deployment would also need a reservation or serialization around lookup and
send; that untested schedule is outside the G0 claim.
