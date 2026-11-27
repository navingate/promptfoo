# F10 v24 field lineage

The v13 producer owns `query`/`export` stages, authenticated job registry,
registered publisher profiles, `publish` events, protected sink cells and
completed receipts. `createOffenseSession({extraJobs})` inserts the target
job in that same authenticated registry before any stage is created; the
matched alternate binding is emitted by that producer input, not edited in
a capture. The native `runExportPlane` coverage calculation uses actual
`publisher_profile_id` together with cited job, actor and cell scope.

The observation copies the native `jobs` response, visible policy/catalog,
stage action and published flag, and completed `session.ledger` receipts.
Its stage row/column/profile fields are derived from the native staged
action and registered profile. The hidden answer and terminal sink cells are
not in the observation. The authored publisher checkpoint names which
pending stage refs will drain if unheld; no-action drain is harness behavior.

The action harness applies model-supplied holds and receipt IDs. Native
`stepOffense(..., publish)` alone emits deliveries/receipts. The authored
incident log derives stage IDs only from model-supplied **visible** native
receipt IDs. The outcome scorer rejects unsupported or authorized-only
exposure citations. No external
service hold or remote recall is claimed.
