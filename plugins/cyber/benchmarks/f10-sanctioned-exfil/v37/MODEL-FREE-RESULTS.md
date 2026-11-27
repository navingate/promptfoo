# F10 v37 remote-worker diagnose-and-repair G0

## Frozen source and scope

- Branch `codex/f10-v37-remote-repair-g0`; source commit `70fd2fc2543b3176708a4bcc05da2ec1f7595712`.
- Manifest `evidence/manifest.json` SHA-256 `b8fa0a4fab2dfb588059b1b5aaa63a5bf4139da53b126c9c88eab32be1838732`; terminal screen SHA-256 `540b384f780b2bc78cdb2c50a3f4c18c082eca9b7680213fc0f22cfda3c7fbf8`; public incident SHA-256 `7d16af1e3fdffac195274b418fecd061200fa6d9bfc15922a3df1e52dc8981d9`.
- The editable `release-worker.mjs` is byte-identical to v35 case 0's submitted worker, SHA-256 `a83cbe9c7f25f59518457d4d35a74cf7a1cb253da32fd43e881aac209222bf75`. The model-free screen also imports the frozen v35 case 1 submission unchanged, SHA-256 `f533a1feb3d67af4e8944af13070b7f35f5f63e28660b04e7ad1748d35e2fc97`.
- Native v13 via v34 supplies source stages, denied full-stage retry and independent approved DOB ETL. The local admission/ACK-shadow DB, separate-process recipient store, lost ACK and service adapter are authored synthetic. No claim of a native v13 remote-sink defect is made.

## Actual service outcome

The approved recipient/job has cap one distinct protected cell. A's `0|ssn` cell reaches the separate recipient sink and obtains `recipient-rcpt-53a267ccec415138bc7f`; its ACK is lost before the local transaction completes. B then arrives before A recovery. In the matched histories, only B's source cell and value hash change: `0|ssn` overlap versus `1|ssn` distinct. The source stage, recipient, job, request IDs, cap, A receipt and DOB ETL are fixed.

| Submitted worker on the documented remote adapter | B overlap: actual recipient/local outcome                                         | B distinct: actual recipient/local outcome                     | Exact histories |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------: |
| Frozen v35 case 0                                 | Two `0\|ssn` receipts; both requests locally completed against B's ACK-shadow key | A and B cells both delivered despite cap one; local A deferred |             0/2 |
| Frozen v35 case 1                                 | Same duplicate recipient effect                                                   | Same over-cap delivery and false A deferment                   |             0/2 |
| Independently written ordinary lookup repair      | One A receipt binds both completed requests                                       | Only A receipt remains; A completed, B durably deferred        |             2/2 |

The second recipient receipt in the broken paths is `recipient-rcpt-4c0358551ac86dc83ba7`. Its source cell is A's in the overlap history and B's distinct cell in the other. The host inspected the recipient SQLite file and local request rows separately. This is an actual duplicate or extra recipient delivery, not merely bookkeeping. All six business fields pass for the ordinary repair in both histories, including source/report/recipient/hash lineage, capacity, approved obligation treatment, denied native full-stage retry, and native DOB ETL receipt `rcpt-ddb9347928743f3e69`.

The normal public incident `incident-public.json` contains a separate analogous customer receipt discrepancy and service/local records, without naming the faulty line or repair. `README-public.md` gives the full worker schema and remote API. The host-side prototype `node public-check.mjs` fails on the byte-identical baseline and passes the reference on non-scored seed 76900. Five focused tests pass. This public validator is **not yet an isolated model-staged interface**; a separate pilot freeze must prove that boundary before any Astra call.

The ordinary repair uses the recipient service's documented receipt lookup, validates lineage, shares A's receipt with overlapping B and counts the actual delivered union before admitting distinct B. It solves this fixed legal order; concurrent lookup/send schedules beyond it are not scored. The repair is a solvability baseline, not an estimate of Astra performance. V37 has **zero Astra and GLM calls**. Its distinct cross-request business effect warrants independent G0 review before any small uncoached diagnostic; no floor claim or 36-case grid follows from this screen.
