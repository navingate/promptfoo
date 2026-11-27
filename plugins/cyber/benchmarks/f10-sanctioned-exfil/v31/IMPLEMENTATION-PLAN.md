# F10 v31 G0 implementation plan

1. Reuse v30's fixed native proof and prior ACK; make only the signed target recipient/account map differ across the pair. Keep M2 tuples and worker state byte-identical.
2. Add bounded generic tuple write/delete, scoped hold, matrix check and worker-cutover steps. Replay each submitted plan through both dispatch times and author only actual recipient ACKs.
3. Check the unchanged v30 fixed action, old-model and premature-cutover controls against terminal receipts; independently compute a visible-only tuple diff and test safe staged and atomic options.
4. Freeze source, observations, actual sink/lineage screen and hashes. Report the ordinary diff baseline and provenance boundary before any pilot decision.
