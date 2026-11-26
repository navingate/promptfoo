# F10 v18 model-free status

V18 is a temporal-authorization regression candidate, not an Astra floor.
Source commit: `293c6594716bd6a96f8051f8569fb111d13cc6ff`.
The 36 deterministic batches are bound by
[`evidence/manifest.json`](evidence/manifest.json), SHA-256
`492dacd0a86eb0c04f212c4ebbdbe386ac455d15cdeda5afed9d7c47946f9d66`.
No v18 Astra or GLM calls were made; invalid/provider counts are not applicable.
The v17 one-batch Astra result remains separate.

## Verified business decision

Every batch has 14 native captures and 26 listed flows. The paired approval and
revocation captures keep the exported events, stages, completed sink receipts,
current registry snapshot, and neighboring authorized ETL identical. Only one
authenticated revision's effective time changes. The correct primary-flow label
flips between sanctioned bulk and cumulative exfiltration at the completed
receipt's time; the ETL flow stays sanctioned. The cross-actor same-cell pair
keeps the bound actor sanctioned and flips the unbound actor between benign and
cumulative exfiltration at the strict aggregate boundary. An abandoned protected
stage has no completed sink receipt and adds no delivered cells.

The separately written visible-only audit follows receipt → effective revision
→ actor, publisher, cell scope, and job capacity. It matched the native sink
truth on **36/36 exact batches and 936/936 flows**. Truth comprised 612
sanctioned-bulk, 180 cumulative-exfil, 108 benign, and 36 ambiguous labels.
Native proof replay and the source/prompt/observation/answer/proof hash manifest
verified.

| Simple playbook          | Exact batches | Correct flows |
| ------------------------ | ------------: | ------------: |
| Current registry only    |          0/36 |       864/936 |
| Stage time only          |          0/36 |       864/936 |
| Ignore publisher profile |          0/36 |       504/936 |
| Ignore cell scope        |          0/36 |       900/936 |
| Ignore actor binding     |          0/36 |       900/936 |
| Job citation alone       |          0/36 |       684/936 |
| Event count              |          0/36 |       210/936 |

The 0/36 exact scores for some shortcuts coexist with high per-flow accuracy;
exact-batch scoring over 26 flows must not be interpreted alone. The ordinary
export audit solves every pair while preserving the legitimate ETL, so the
coordinator directed us to retain v18 as regression coverage and skip its Astra
pilot. F10's defensive Astra floor remains unestablished. A genuinely distinct
successor is needed for a new calibration attempt.

## Reproduce

From the repository root under `.nvmrc`:

```sh
node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v18/native.test.mjs
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v18/screen.mjs
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v18/freeze.mjs
```

G0 semantic approval and release gates remain pending. This is a portable
synthetic estate and supports no product-fidelity or deployment claim. V13,
v15, v16, and v17 code, scores, and raw records remain unchanged.
