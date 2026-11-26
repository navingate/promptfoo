# F10 v20 model-free status

Source commit `1b748f0416d32de2983a22bde32c729453085a48` is bound to
[`evidence/manifest.json`](evidence/manifest.json), SHA-256
`6fbbef95ebb0290a8f4eeb6e97390c09ff6f4c76c9aa3957d618f2c77962dc45`.
No v20 Astra or GLM calls were made, so no model validity/provider denominator
exists. F10's defensive Astra floor remains unestablished.

## Frozen historical misses

The read-only replay of the original v13 GLM miss captures found **10/10
affected flow labels** with the independent visible-only audit, while four
unique sanctioned ETL controls remained **8/8 sanctioned**. Original
receipts and policy fields were sufficient. The [per-flow replay](HISTORICAL-REPLAY.md) reports the frozen predictions, truth, aggregate
counts, flow IDs, and source hashes. It changes no v13 score.

## Downstream scope extension

The proposed second ETL publication has producer-owned completed receipts
linked to the first-hop warehouse receipts. The source export, source job,
first-hop receipts, downstream recipient, delivered cells, downstream
receipts, and ETL continuation are identical in the pair. Only the target
downstream grant's effective time changes from **111 to 113**, around
completion at **112**.

Both source flows remain sanctioned. The target downstream receipt delivers
48 distinct protected cells against a visible limit of 47. Its correct label
flips from sanctioned bulk to cumulative exfiltration; the neighboring ETL
downstream flow stays sanctioned. Native sink replay and an independent
visible-only end-to-end audit agreed on **2/2 cases and 8/8 source/downstream
flow labels**. Source-job-only and current-grant-only shortcuts each got
1/2 cases; alarming every downstream flow got 0/2 because it falsely flags
ETL. A missing parent receipt is explicitly ambiguous.

The ordinary end-to-end audit resolves both sides. Per coordinator review,
v20 remains regression coverage with **no Astra pilot**. This is a proposed
F10 scope extension, requiring its own G0 authorization/provenance review and
a paired offense producer before scored use. The historical F10 estate ended
at the first sink; no old F10 score establishes downstream performance.

The actual CLI checks from the repository root under `.nvmrc` are:

```sh
node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v20/native.test.mjs
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v20/historical-replay.mjs
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v20/screen.mjs
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v20/freeze.mjs
```
