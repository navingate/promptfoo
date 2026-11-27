# F10 v30 G0 implementation plan

1. Reuse the frozen v28 native source and prior authored ACK; add a separate immutable M1/M2 registry, visible signed business amendment, worker query/pin ledger, and one-tuple backfill pair.
2. Replay bounded data-only rollout steps across first dispatch and terminal drain. Author recipient ACKs only on released chunks, with source stage, report, recipient, row and value-hash lineage. Produce a future native DOB ETL sink receipt through v13.
3. Test the M1 fresh-check disclosure, unbackfilled M2 omission, safe staged and atomic procedures, source retry denial, truthful prior ACK, and ETL continuity. Score terminal effects independently of a preferred step string.
4. Run the actual screen, freeze source/fixture/screen hashes, report the ordinary baseline and claim boundary, then submit for independent review. No Astra or GLM call.
