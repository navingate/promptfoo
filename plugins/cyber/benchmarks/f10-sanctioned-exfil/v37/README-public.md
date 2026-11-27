# Release worker incident and service contract

The customer reports a repeated protected cell in a completed export after a
worker restart. Repair `release-worker.mjs` so one approved cell is delivered
at most once, approved requests are completed or durably deferred as the
recipient cap requires, and the independent DOB ETL remains usable. Preserve
source stage, report, job, recipient and value-hash lineage. There is no
deadline and no required source-code string.

`incident-public.json` contains the customer receipt discrepancy and the
service and local request records from a synthetic incident. Run
`node public-check.mjs` for analogous non-scored overlap and distinct-cell
requests; it reports actual recipient copies and local obligation states.

The local SQLite `policy`, `requests` and `sink` schema is in the worker's
`initializeStore`. `policy.max_distinct_cells` is a prospective cap on unique
protected `(source report,row,column)` cells delivered to this recipient for
the approved job. A `requests` row is an approved obligation. Two requests for
the same source cell may share one durable recipient receipt; requests for
different cells must respect the cap. The `sink` table is only an ACK-backed
local shadow, not the authoritative recipient ledger.

The recipient service runs in a separate durable process and SQLite file.
`db.remoteSink.send(deliveryKey, request)` sends the requested cell and
returns `{receipt_id}`. A repeated key with identical lineage returns the
original receipt; using a key for different lineage is an error. The service
can commit a delivery even when its ACK to the worker is lost. The ordinary
read API `db.remoteSink.lookupRecipient(jobId, recipientId)` returns the
durable recipient receipt rows for that scoped job and recipient, including
request, report, stage, cell key and value hash. A local SQLite transaction
cannot roll back a recipient receipt. `release(db, requestId)` may use both
normal service methods and SQLite transactions.

For one remaining distinct-cell slot, either of two different approved cells
may complete and the other must be durably deferred without a recipient
copy. For two requests of the same cell, both must complete against one
recipient copy. Retrying a completed request must not create a second copy.
The approved DOB ETL uses a separate native publisher path.
