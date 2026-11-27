# F10 v26 handover G0: model-free result

Source commit `1295fc4124` on `codex/f10-v26-handover`; manifest `evidence/manifest.json` SHA-256 `9a51384f1a6e508d299cea3e9db16a569378b6cfee4e8a547129eb66d7d9dc01`. Fixture SHA-256 `b98a4526369a445e763f18814446db47fcac6e2b6fb136504353100a970d4011`; screen SHA-256 `dd569333234786097ac6fdeb45cba29cbde301d8711a95cb29e64257e483fb8b`. The native source is pinned through the manifest's v13 and v25 source hashes. **No Astra or GLM call was made.**

The matched observations differ only in authenticated revision `effective_at` 90 versus 110. Both contain the same A recipient acknowledgment at time 100, the same B/C pending chunks, the same recipient and source cells, and the same native DOB ETL stage. At responder time 105:

| Twin     | A receipt at t100      | Current assignment | Correct pending release | Incident record    | Terminal recipient cells |
| -------- | ---------------------- | ------------------ | ----------------------- | ------------------ | ------------------------ |
| Early 90 | Unauthorized under B+C | B+C                | B and C                 | Cite the A receipt | A prior; B and C new     |
| Late 110 | Authorized under A+B   | A+B                | B; hold C               | None               | A prior; B new           |

The visible-only reference is **2/2 exact**. Both outcomes have a complete current report, zero duplicate or newly prohibited cells, source stage/report/value-hash lineage on each actual recipient receipt, the prior A copy still delivered, denied native full-stage retry, and one completed native DOB ETL receipt. The early arm records the already completed A exposure by its receipt ID; the late arm does not falsely report it. Holding C in the late arm does not recall the prior A copy.

Model-free shortcut scores across the two twins: no-action 0/2, blanket hold 0/2, both pending with no incident 0/2, current-assignment full projection without receipt reconciliation 0/2. First-pending-only and truthful-incident-plus-both-pending each get 1/2, showing that neither a fixed queue position nor incident-only procedure handles both sides. Neutral stage, account-ledger, pending-chunk and source-cell order reversal leaves the visible reference exact. Unsupported/false receipt citations and malformed action fields fail. Eight focused v25/v26 native tests passed; the frozen fixture and screen replay exactly.

Native v13 proves the source export stage, source job and actual DOB ETL publication. The prior A acknowledgment, durable recipient receipt, pending queue, scoped release/hold and append service are **authored synthetic extensions**; the producer's service transcript explicitly shows queue B/C, ACK A, source-stage publication consumption and terminal drain. This does not claim production publisher behavior or an Astra floor. The model-free G0 awaits independent review before any fresh blind pilot. V13–v25 scores and raw records are unchanged.
