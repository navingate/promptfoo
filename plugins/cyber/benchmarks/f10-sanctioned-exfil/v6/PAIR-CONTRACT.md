# F10 v6 paired producer and defender contract

The offense producer `f10-v6-offense` version 6 and defense consumer
`f10-v6-defense` version 6 share contract `f10-pair-v6.1`. The producer
implementation is bound to commit `0ae3eed3837fe8e99cf53d4d439465b5ec7567f4`.
The observation serializer is bound to
`411baabdef2e925c1c89a0b246e69c1214c16713`. The manifest and audit
tests verify the exact bytes before any defense model request.

| Evidence                | SHA-256                                                            | Ownership              |
| ----------------------- | ------------------------------------------------------------------ | ---------------------- |
| Capture manifest        | `bd373220965d41897fe22c0eaf8a144e45217f749a203525e665705b339280c6` | Shared binding         |
| Native visible captures | `c1bcb54afa078a322e1db41103d39a715b732684fdc44cbebbf1b3ea31eccbe8` | Producer to defender   |
| Evaluator answers       | `44a0ce437813c62af1b2c20d44c4b6ce01c7f7afea83e5b5e3864cc406166a03` | Evaluator only         |
| Actual sink proof       | `47d17aae2b272354f28dee0d056c5459a2fcc26916651ac5de6ed80113cde3eb` | Evaluator only         |
| Field lineage           | `afa0ca2fd490de6b9464ba3e123498b9879536f69da0b0b6f31ad36eafea33a0` | Shared validation      |
| Observation manifest    | `43009ab358175cb79465d2ded07c8e7f6bbd85b6ee38396429ba4423a1e29189` | Exact defender context |

The fixed 12 seeds `12001`–`12012` each contain five captures:
`malicious-fanout`, `covered-fanout`, `wrong-bound-job`, `below-limit`, and
`blocked-oversize`. The covered case reuses the malicious operations but
cites an actor/destination/window-bound job; the wrong-bound case cites a
real job without the required actor authority. Below-limit is completed but
benign. The blocked action has no completed sink flow. Capture order is
deterministically shuffled, so position is not a label.

`capture-producer.mjs` drives the native query, stage, publisher, and sink
path. The visible file contains native policy, catalog, job registry,
completed events and sink receipts, with only derived IDs/flow grouping.
The sidecar records the actual delivered cells **and their values**, native
actions, ledger, receipts, nonce, and truth. The consumer replays each case,
compares the sink values and native receipts, checks hashes and every visible
field's lineage, and builds a non-enumerable `_key` solely from the answer
sidecar. It separately checks an independent reference detector against that
key. The model receives only the exact system prompt and serialized visible
captures/flows recorded in `observation-manifest.json`.

This is a synthetic estate pair. It establishes conformance and matched
counterfactuals for this simulator, not telemetry fidelity to a production
warehouse or an independent G0 construct approval. G0–G7 remain review gates.
