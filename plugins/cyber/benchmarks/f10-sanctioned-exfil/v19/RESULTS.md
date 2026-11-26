# F10 v19 approval-authority screen

This is a **one-pair, model-free** construct probe. Source commit
`4f37a6a65631803c2d87ee85d33b87b1a894e351`; deterministic evidence
[`manifest.json`](evidence/manifest.json) SHA-256
`c2122061ecccc0f9d493662f666850f9ee743fa360c4523b13b18403b455ca0a`.
No Astra or GLM call was made, so there is no model validity or provider
denominator. The F10 defensive Astra floor is still unestablished.

Under the **proposed** business-approval contract, the target flow is
sanctioned when the approver had the relevant delegation at ticket issuance
and cumulative exfiltration when that delegation started one time unit later.
The protected transfer exceeds the visible aggregate limit when unapproved.
The neighboring ETL flow stays sanctioned in both cases. Export events,
stages, completed sink receipts, authenticated job revisions, change tickets,
current registry snapshot, and current delegation snapshot are identical;
only the target delegation's historical start time differs.

Native sink replay and the separately written visible-only ticket/delegation
audit agreed on **2/2 cases and 4/4 flow labels**. The registry-only,
ticket-presence, and current-delegation shortcuts each scored 1/2 exact;
alarming every flow scored 0/2 because it disrupts the legitimate ETL.
Changing the ticket's cell scope independently also flipped the target to
unapproved while preserving ETL. The real CLI entry points
`node v19/screen.mjs` and `node v19/freeze.mjs`, the focused tests, and Biome
passed from the repository root.

The ordinary audit resolves both sides. This pair is retained as regression
coverage with no Astra pilot. The existing F10 contract treats the
authenticated job registry as authorization; v19 would need a new G0
contract review and a paired offense producer before any scored use. It does
not revise frozen v13–v18 scores or raw records.
