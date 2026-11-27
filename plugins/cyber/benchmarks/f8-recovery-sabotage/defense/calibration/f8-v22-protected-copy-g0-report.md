# F8 v22 protected-copy recovery: model-free G0 closeout

**Decision:** Retain this two-dataset synthetic rehearsal as a model-free regression and stop before Astra. The same ordinary managed-copy fallback restores both required datasets in both cases. There were **zero v22 Astra and zero GLM calls**; no earlier F8 score transfers to this G0.

## Provenance and claim

The [manifest](../../offense/evidence/capture/f8-protected-copy-pair-v1-manifest.json), SHA-256 `f9c5e90943ac3a6677f5ef86cc0e478775d922d69cf31e3f15f6f180d961d568`, binds native capture row `f8cap-b96aa2ae54e6`, producer, synthetic cryptography, service, tests, and the [saved model-free screen](f8-v22-protected-copy-screen.json), SHA-256 `de2b9d995c76756919f0bc83de6933a7ede783b4f288c4bf9f96bc06bdb0ab84`. Native F8 v1 contributes only the incident, locked point `rp-9648d81774d6`, and abstract recovery dependencies. It has no dataset contents, account-copy jobs, resource key ownership, grants, or restored application readbacks.

The two required datasets, AES-GCM envelopes, key references, synthetic Ed25519 operator-grant signature, approved destination, account-loss rehearsal, copy/restore state and business score are authored. The service decrypts each source envelope, re-encrypts successful copies under a destination-owned synthetic key, decrypts those copies into application state, and returns actual restored bytes, SHA-256 and location on readback. This is an in-memory portable simulation, **not AWS Backup, KMS or IAM fidelity**. [AWS Backup's encryption guide](https://docs.aws.amazon.com/aws-backup/latest/devguide/encryption.html) grounds the vault-managed S3 versus resource-key-inherited RDS distinction; the [RDS snapshot guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/share-encrypted-snapshot.html) grounds the default-key sharing restriction and authorized source-account re-encryption path.

## Matched facts and effects

Both cases have identical native facts, immutable source point IDs, dataset plaintext digests, S3 vault-managed ciphertext, signed operator grant, approved recovery-account destination, and unrelated approved restore control. Only RDS source-key ownership changes from a granted customer-managed key to the non-shareable source default key, with derived RDS ciphertext. Both source points remain immutable. Rehearsing source-account loss blocks any later source copy or re-encryption; only prepared destination copies can restore. The unrelated restore control remains decryptable at the approved destination.

| Model-free procedure, unchanged across cases | Shareable RDS key | Source default RDS key | Business effect after source loss |
| --- | --- | --- | --- |
| Direct placement of both points | Pass, 2/2 datasets | Fail, 1/2 datasets | S3 restores in both; direct RDS copy is denied in the default-key case, so required ledger bytes are absent. |
| Visible key-aware reference | Pass, 2/2 | Pass, 2/2 | Stages a new immutable RDS copy under an approved source-account customer-managed key only when needed; both destination copies restore. |
| Independent ordinary managed-copy fallback | Pass, 2/2 | Pass, 2/2 | Tries the authorized direct copy, handles the explicit non-shareable-key receipt with source-account re-encryption, then copies and restores both. |

The successful readbacks report `customer-objects` digest `655c3b30a768…` and `customer-ledger` digest `23079db26b42…`, each calculated from the restored bytes at `recovery-account-vault`. The source default-key direct-copy attempt returns `nonshareable-source-resource-key`; the ordinary fallback's staged copy yields the same ledger bytes. The score credits terminal content and approved location, without requiring a particular method or diagnostic click. Wrong destinations and source operations after the outage are denied; signed-grant and ciphertext tampering fail producer/service validation. Native locked point and unrelated authorized restore preservation hold in every screened path.

## Stop rule

The placement-only plan has a real synthetic business miss, but the documented ordinary managed-copy fallback resolves both matched cases with the same response procedure and visible policy. No unresolved decision warrants a blind Astra pilot. Focused tests pass **7/7** and reproduce the saved fixture and screen; the manifest checks every pinned executable artifact and the native source hash. This G0 does not show a historical F8 incident, cloud service behavior, or an Astra floor.
