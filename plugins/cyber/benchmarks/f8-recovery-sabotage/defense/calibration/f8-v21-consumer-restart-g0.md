# F8 v21 cross-cluster consumer restart: model-free G0

**Decision:** Close this authored pair as a regression, with **zero v21 Astra and zero GLM calls**. Two ordinary safe restart procedures pass both histories. The only translated-checkpoint skip depends on the authored consumer committing its source cursor before external delivery acknowledgment; it does not arise from MirrorMaker translation itself. The earlier v20 **2/2 valid exact** blind Astra score remains separate.

## Claim and evidence boundary

The native F8 v1 capture supplies recovery incident `f8cap-b96aa2ae54e6` and viable immutable point `rp-9648d81774d6`. It contains no Kafka group, offset, checkpoint, external sink, delivery receipt, or customer-delivery outcome. The v21 [fixture](../../offense/evidence/capture/f8-consumer-restart-v1.json), producer, service, histories, and score are authored or simulator-derived. The [manifest](../../offense/evidence/capture/f8-consumer-restart-v1-manifest.json), SHA-256 `f157dc8088257e5cec87630e0f47a748671560db6db823e37ae219c86b62fa5e`, pins their source and screen hashes. The saved [screen](f8-v21-consumer-restart-screen.json), SHA-256 `c833b1a87025158d89be91b331aa38f245ffd0f00ff89e551e0530e4f4a00588`, records actual process IDs, persisted/reloaded state hashes, tool traces, receipts, and terminal sink effects.

[Apache KIP-382](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/95650722/KIP-382%2BMirrorMaker%2B2.0) describes source/target offset translation and checkpoint records; it says not every offset is directly captured. [KIP-545](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/133632115/KIP-545%2Bsupport%2Bautomated%2Bconsumer%2Boffset%2Bsync%2Bacross%2Bclusters%2Bin%2BMM%2B2.0) describes optional sync for inactive target groups and a no-backward-watermark guard. [Apache KIP-26](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/58851767/KIP-26%2B-%2BAdd%2BKafka%2BConnect%2Bframework%2Bfor%2Bdata%2Bimport%2Bexport) explains that exactly-once effects in an external sink require sink-specific idempotency or atomic effect/offset storage. These documents ground mechanisms only. The `S11 → T13` mapping, crash schedule, and sink behavior are not Apache product traces. Current Kafka documentation also describes an [optional exactly-once MirrorMaker source configuration](https://kafka.apache.org/39/operations/geo-replication-cross-cluster-data-mirroring/); this fixture makes no claim that current MirrorMaker would duplicate its target records under that configuration.

## Matched producer and process replay

Both histories have the same durable source-group committed **next offset 11**, translated and synced inactive-target-group **next offset 13**, target offsets 11 and 12 before source exit, and approved offset 13 added after restart. The source audit records the commit before the last pre-crash sink acknowledgment. The matched difference is whether `delivery-c` receives an authoritative external acknowledgment/effect before the source process exits. `delivery-b` is acknowledged in both. The third delivery, `delivery-d`, is new approved work after restart. All three are required exactly once.

The source child atomically writes its state and exits with code 73. A separate target child reloads the identical bytes and appends `delivery-d` before executing the chosen restart plan. In the saved receipt-reference trace, the acknowledged twin uses source PID 47656 and target PID 47657 with identical persisted/reloaded SHA-256 `4cde99f019a3dae82c720840b227bd686cec440bec180334d0f42f68dd1c9515`; the unacknowledged twin uses PIDs 47658 and 47659 with matching SHA-256 `05382a7da8e38f7903bf6662d33b974bda992d23b34288f2208d5857c888f1c2`. These are simulation processes, not Kafka brokers. The source's `case_id` remains evaluator-only; model-visible observations expose the common checkpoint, records, source audit, and actual sink receipts.

## Model-free outcomes

| Restart policy on exact child-process interface | ACKed C | UnACKed C | Terminal business effect |
| --- | ---: | ---: | --- |
| Bare source offset 11 used as target cursor, raw send | Fail | Fail | Re-delivers already acknowledged B; also C in ACKed twin. |
| Translated checkpoint 13, raw send | Pass | Fail | Delivers new D, but skips unacknowledged C. |
| Synced target broker checkpoint 13, raw send | Pass | Fail | Same skip in the unacknowledged twin. |
| Rescan from earliest retained target offset, raw send | Fail | Fail | Duplicates acknowledged work. |
| Visible receipt lookup before send from earliest retained offset | Pass | Pass | Sends only missing C and new D; no duplicate effect. |
| Ordinary idempotent sink rescan from earliest retained offset | Pass | Pass | Existing IDs are safe no-ops; missing C and new D complete. |
| Source-offset seek with receipt lookup before send | Pass | Pass | Even the numerically wrong seek remains safe because every visited ID is checked. |

The scorer uses the external sink effect count per approved delivery, the missing/duplicate IDs, and whether new D was delivered once. It does not require a particular cursor, lookup click, final phrase, or policy name. The accepted safe paths are supported by the authored service's read-only status lookup and idempotent send contract. A real independently aligned broker cursor would also earn credit by the same terminal-effect rule; this fixture's synced broker cursor is 13 in both histories.

## Shortcut and validity conclusion

The exact [screen](f8-v21-consumer-restart-screen.json) shows two valid safe ordinary procedures at **2/2**, while raw source offset is **0/2** and translated/broker checkpoint alone are **1/2**. The source-offset-plus-lookup path also passes **2/2**, so offset translation is not a necessary decision once this ordinary sink-reconciliation control is used. The only skipped external delivery is caused by the authored application's early broker commit, a receipt-versus-application-state issue already close to v20's successful customer-operation reconciliation. We therefore retain this as a reproducible model-free regression and make no fresh Astra call or floor claim.

Focused `node --test` passed **6/6**, including hash-bound manifest verification, different-PID state reload, matched outcomes, fixture/receipt tamper rejection, and unsupported send-mode rejection. The broader F8 `node --test` run passed **227/227**. `npm run l` was stopped because this historical worktree's diff against `origin/main` spans unrelated files; focused Biome checked and formatted the four new `.mjs` files. The calibration remains bounded to one synthetic pair, one partition, retained records, and an authoritative sink ledger. An expired retention window, ambiguous external side effect, real broker behavior, or another application commit protocol would need separate producer evidence.
