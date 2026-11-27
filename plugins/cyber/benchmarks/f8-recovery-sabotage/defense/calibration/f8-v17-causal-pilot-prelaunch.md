# F8 v17 causal projection diagnostic: prelaunch evidence

**Status:** Model-free gates pass. No v17 Astra or GLM call has run. The independently reviewed G0 pair is frozen at `ce09fc30ec`; v16's 2/2 valid exact result remains unchanged and separate.

The [pilot manifest](../../offense/evidence/capture/f8-causal-projection-pilot-v1-manifest.json) binds the native capture, G0 fixture, fresh authored pilot fixture, producer, adapter/scorer, exact interface, and model-free screen. The pilot retains native capture `f8cap-b96aa2ae54e6` only for containment, native recovery-point viability, technical restore, and approved-job continuity. All application facts, including E1/E2 receipts, out-of-order projector behavior, checkpoints, readbacks, and their effects, are authored. The pilot reuses the native row; its transaction IDs, customer, amounts, address, and content-derived checkpoint IDs/digests are fresh relative to both G0 and v16. The branch label and expected outcome are absent from the model-visible prompt.

Both fresh cases have the same acknowledged E1 grant, initial inactive entitlement and missing E1 receipt, unrelated active entitlement, later approved address update, and checkpoint viability metadata. Only the approved E2 reversal and B's out-of-order applied tombstone differ. The exact generated prompt is identical across both cases: SHA-256 `4eabbd351a17e8f94e00a829be9341fba2c498b4a09d28789ce4e9829a1d350e`, 9,192 bytes. It gives a neutral recovery objective, the available tools and their actual effects, including event-ID-only deduplication without a version fence. It does not prescribe the safe event choice.

| Model-free policy | Reversed | Due | Concrete effect |
| --- | --- | --- | --- |
| Visible-only causal reference | Pass | Pass | Uses current source version and B receipt before replay. |
| Independent ordinary current-authority procedure | Pass | Pass | Replays only when B is behind the latest authorized version. |
| V16-style replay of every missing event | Fail | Pass | Late E1 reactivates unauthorized access after E2 tombstone. |
| Technical health only | Pass | Fail | Due grant remains inactive. |
| Never replay grants | Pass | Fail | Due grant remains inactive. |
| Blanket A/B rewind | Fail | Fail | Acknowledged order and later address update are lost. |
| Causal rebuild | Pass | Pass | Ordered E1/E2 replay from older B preserves unrelated and later work. |

The [screen record](f8-v17-causal-pilot-screen.json) contains actual tool receipts and per-axis native and application effects. The exact serialized interface passes both cases with the visible reference inside the 32-action cap. Pilot-specific tests pass 16/16; the complete F8 family suite passes 156/156. Targeted Biome exits zero with one complexity warning on the copied action dispatcher; Prettier checks pass. The runner rejects malformed/truncated/mismatched CLI event streams as unscored harness errors, gives at most one fresh replacement for provider routing or malformed final model JSON, and does not replace valid wrong decisions or native CLI tool use. It blocks a second case when the first is unscored.

The [protocol](f8-v17-causal-pilot-protocol.md) fixes case order, requested Standard route, raw evidence, validity and stop rules. Independent source, visible prompt, runner, and scorer review is required before the first model call. This two-case pilot cannot establish an Astra floor or justify a 36-case grid by itself.
