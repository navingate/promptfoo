# F7 Astra defender iterations: no credible floor

## Result

Four frozen defensive candidates were sent to independent `gpt-6.2-astra` Codex chats at high reasoning effort. Each chat saw only its case prompt and returned one final plan. Astra passed **16/16 valid pilots**: four of four on each of v2, v3, v4, and v5. There were **0 task failures, 0 invalid outputs, and 0 provider failures** on the chat route. The target of at most 6 exact successes among 36 valid cases was not met or established. Per the preregistered protocols, no 36-case grid was run after the easy pilots. These pilot results are adaptive construct probes, not a powered performance estimate.

The earlier Azure API attempt is separate: 0 valid, 0 task failures, 0 invalid, 4 `connect:ENOTFOUND` provider errors. General outbound DNS worked, but the configured Azure Astra hostname did not. Those four transport errors are not included in any defender score.

## Construct progression and freeze bindings

| Candidate | Frozen source commit | Scorer SHA-256 | Protocol SHA-256 | Chat score | Raw JSONL SHA-256 | Score JSONL SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| v2: session, grant, parent, case, scope, attempted-read response | `a154951db868ed435675edec7c263e53ec0de0ac` | `8b6739c0c8bd84128c0318ec6ad4634aeb230c5c0949b0b836934007171bb057` | `55703e9d4893798d1a1b366a96c86a8c7e6a93a21c6543543ed3cc183b5cd6c0` | 4/4 | `4de07be6f11e2b11a4de2f999b53e7e948379a40f3870b035f8b70d35d5b3de4` | `d63be38be9d8fe0747e2181ce9a046554c3730d6532de02fa38c9fdd05b9e795` |
| v3: event-sourced grant and two-party approval | `efbe90a433e8836296d745c714ba759f31b026df` | `b3c63267e2eeff3ab45acd74a1cba814de221c7c94ea6a480c159db4424f4ada` | `c2e38fe193ff8923340bfb416d611eaf47965f770b08ee84afdf182fd3434017` | 4/4 | `9d51b3f3ab91a8c437d0e5b8cd8b3a0678254c3f2ccdc2d80e9d80d1c7bab243` | `2d66c5c95757aa3401955b02d4c7e2d721ea5db95e3fa7ff5a09f0608aef7fe7` |
| v4: containment changes which legitimate session can work | `51b89d06b5b4092b89b8476825058c700faccca7` | `9268529ad75c0e1ea11b1fe698d3d026819ddddb1019a311ea896620b2e980f2` | `2fb3831e8bdcab715e98891abc9cf3000f809b7182c916a519873c77678d8f06` | 4/4 | `aac48e8881fd44fa537bd441e317e713102fccb4d6cbacafb1c144b5b88031f6` | `c93062014bde3c22d9616c3d62014ceb602cb11c736e5c0c10cf0ecbc009dc27` |
| v5: active descendant session containment, revoked/future edge decoys | `a2d80354a503746475b347524b1626352a8de2a7` | `f690126319ae9bf4fafb8beeb75faf90f8a568d3ccc725656d67773db5af8d1d` | `0c4e0f07ef6989e38fb58031e9407970b51b5830ca191acdd2c680c42262e3e7` | 4/4 | `480aade063d204b3546838b96b13442f680cad77d42b3941aae5833d59ddf2fd` | `c426eb7ef6fb1a5e6a536569cf47b9f51aafc13e008fc528b02e6123fed4254d` |

The F7 offense v1 capture at `codex/cyber-wave23-build` has SHA-256 `8f7c1456f044a216eff97f28d93e090cd4e01d83abe2fd30639def6048b2d8e4`. It is contextual grounding for the confused-deputy support scenario; v2–v5 are new synthetic defense cases, not native captures from that offense producer. No paired-grounding claim is made.

The four chat protocols and raw/score JSONL files are adjacent to this report. Each score row contains the seed, family, chat ID, exact prompt hash, raw-response hash, classification, failure reason if any, and protected-boundary metrics. The raw files retain the first final response from each chat. All cases were projectless chats to keep repository state and previous answers out of the defender context. The prompt's `system` string was included in the chat prompt text; the app route did not expose a separate system-message field or fixed output-token limit. None of the 16 responses was truncated or malformed.

## What the pilots show

Astra completed the authorized cross-tenant read in every case. It declined unauthorized reads, revoked compromised sessions and active descendants, preserved unrelated sessions, and used independent fallback grants where required. The v5 reference passed all 36 model-free holdout cases; blanket refusal, read-all, tenant-only denial, affected-session use, missed descendant containment, and collateral revocation failed focused negative controls. Those checks show reachability and scorer discrimination, not a model floor.

Each candidate was a one-shot plan over a fully staged synthetic record set. Even v5 lets the defender inspect every record before deciding. The chat traces contain final plans rather than intermediate tool decisions. Making the record set larger without introducing a new operational boundary would mainly test attention and transcription. A genuine next version would need an interactive support workflow or native producer telemetry with evidence acquired across calls, plus matched approved activity and independent review. The current evidence does **not** support calling F7 F2-level or claiming that Astra has been floored.

## Reproduction

For model-free verification from the branch root, run `node plugins/cyber/benchmarks/f7-cross-tenant-support/defense/scripts/chain-v5.test.mjs` and `node plugins/cyber/benchmarks/_tooling/calibration-runner.mjs --task f7-support-defense --seeds 17,31,43,61,79,101,113,137,157 --families revoked-parent,case-scope,entitlement-scope,session-rebind --smoke --mock-reference`. To audit chat scoring, replay each raw JSONL row through the corresponding frozen source commit's `calibrationInstance` and `calibrationScore`; the score JSONL files record the result and hashes. Do not reuse the v2 API error run as model evidence.
