# F10 v29 model-free implementation plan

1. Reuse the frozen v28 source observation for the historical V1 R1-A ACK and recipient identities. Create one deterministic authored V2 protected cell and version watermark at t150. Keep those byte-identical across twins.
2. Represent the t140 signed amendment as one authenticated record whose only twin difference is `effective_at=140|170`. Model revision130 cached and authoritative/minimum-version reads. Apply each read to the existing recipient-scoped v28 evaluator at t160 and t180.
3. Append authored recipient ACKs only after a release decision. Retry still-pending chunks, deduplicate by exact V2 version, recipient and cell, and verify source-value hash lineage. Independently run the approved native v13 DOB ETL query/export/publish at t165.
4. Write a separate visible-only reference choosing the ordinary full-strength read. Screen cached, hold-all and blanket-pause controls against both terminal histories. Freeze source, fixture, manifest and screen hashes. Report the ordinary-control finding; make no v29 Astra/GLM call if it passes.
