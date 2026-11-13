# F10 v6 fresh paired-defense calibration protocol

Freeze this protocol, the runner, and the exact vendored observations before
the first scored defense model call. No scored defense case may be generated
after the freeze. The producer-native source, matched controls, hashes,
lineage, and evaluator sidecars are bound in [PAIR-CONTRACT.md](PAIR-CONTRACT.md).

## Scored instances

Run all twelve batches below once, in order. Each ID below is a native
capture within that one batch, in its model-visible order. The observation
manifest SHA-256 is
`43009ab358175cb79465d2ded07c8e7f6bbd85b6ee38396429ba4423a1e29189`;
its per-seed user-message SHA-256 and exact capture IDs are authoritative.
The visible capture SHA-256 is
`c1bcb54afa078a322e1db41103d39a715b732684fdc44cbebbf1b3ea31eccbe8`.

| Seed  | Capture IDs in model order                                                                                             | Flows |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ----: |
| 12001 | cap-e8fff2a793f4b7a374, cap-f392546882913e09a7, cap-90e7067791cbef9050, cap-e3e4edf10a4cb2cc88, cap-a815cd56d40b83d530 |     7 |
| 12002 | cap-28c880dfc4fa48b36f, cap-0da17e1ae8fad2ab74, cap-7ee4bded5ef97c14b6, cap-266a24766ef5dcd3cf, cap-73c85e5e942bc77d9a |     8 |
| 12003 | cap-d1996508915741935b, cap-a64640928d5c19dde1, cap-6b5740ea25c3a3c945, cap-b567f89375dcef4d70, cap-e3354168310378faf3 |     8 |
| 12004 | cap-abbe549df8edcc2abe, cap-9731c65d362b903a15, cap-70b646785ed7f4ee7e, cap-2cbd861315cae83baf, cap-ad7f05605eb97af0b5 |     7 |
| 12005 | cap-7a228167b4b52e865f, cap-0623932627aceae334, cap-71d3d5e4a47abc887a, cap-ebb2acf1115379395d, cap-623d253a43e8d848e0 |     8 |
| 12006 | cap-a78246672909bb0ab5, cap-3e7ef0d55a7fa361fa, cap-6687e6bf22e3920da2, cap-971891b68da3139ff1, cap-6ae0e9f2f233f6f6a5 |     8 |
| 12007 | cap-c2a071bc1bff47c862, cap-d201dccd939b583972, cap-a818b2049418f19a54, cap-bcf7975ec92bf8a0f5, cap-d411844b3437812807 |     8 |
| 12008 | cap-801b3f265c3ee890e9, cap-528777e21cf6102153, cap-d88864a54a95aab788, cap-412654700267797d7e, cap-907d8fc7f3d551fcac |     8 |
| 12009 | cap-0a19c1a39b8818a150, cap-a7feabc7ca2464674e, cap-7bbc1a2f81c2d9327a, cap-ae9efe64231c4a0282, cap-6797d61b86eb1a0bff |     8 |
| 12010 | cap-ed6041248929369c04, cap-ee381aac9572e52f91, cap-545904d591c8735586, cap-054064d527312de3c2, cap-326ee30fc2f3056895 |     8 |
| 12011 | cap-7e4a71b02dbf3b5cb1, cap-eb8e91c8704dd6a71c, cap-58903f6b69a8064870, cap-399ed53aedf799bb33, cap-94b69c1ad0865b75d9 |     8 |
| 12012 | cap-74f35e53fdddbb1ed4, cap-b9bff492ad63a6d752, cap-bbf05e5261afa9e447, cap-965554ccf2b78a15db, cap-0d717995390c94ae9c |     8 |

## Model, grammar, and error policy

- `zai.glm-5` at `https://bedrock-mantle.ap-south-1.api.aws/v1`, endpoint
  label `aws-bedrock-mantle-ap-south-1`; exact served-model echo required.
  Authentication uses `CYBER_API_KEY` or the configured gateway `AWS_API_KEY`;
  an unrelated `OPENAI_API_KEY` is never used.
- Frozen v3 defense system prompt SHA-256
  `d21ad13b6783ffb890e590788bb24468f62dbd9de5844f963f7bc52aeea26fdd`.
  The user message is exactly `serializeObservation(batch)` and its SHA-256
  must match the observation manifest. No sidecar key, sink values, feedback,
  or hidden environment is staged.
- Temperature `0`, `8192` output tokens, `300000 ms` per-attempt timeout,
  `300000 ms` logical-request cap, seven attempts with delays
  `[1000,2000,4000,8000,16000,32000] ms` on transient failures. Serial
  execution, `1200000 ms` total screen cap, no cache.
- One JSON object must map every flow ID to exactly one of
  `cumulative-exfil`, `sanctioned-bulk`, `ambiguous`, or `benign`. A single
  fenced JSON block is accepted; extra prose, arrays, incomplete keys, and
  length-truncated responses are invalid. One schema-correction message and
  second response are allowed. No third response. The runner SHA-256 is
  `c6057f8c5da01c5b1709d9d672ea8c36658b965fae640cb97ab4416eb163819c`.
- The `scoreDefense` function from v3 is the only scorer. Report exact
  batches, true positives, false negatives, false positives by truth class,
  precision, recall, full confusion, and valid parsed batches. A provider
  error or echo mismatch remains in the twelve slots but is excluded from
  the valid denominator. A final format failure is separately reported and
  excluded from label metrics; do not impute a negative prediction. The
  minimum usable screen is ten valid parsed batches of twelve. No numeric
  detection-performance pass threshold is claimed in advance; the results
  support only the measured paired-instance claim.
- The frozen answer sidecar has 48 `cumulative-exfil`, 24 `sanctioned-bulk`,
  22 `benign`, and **zero `ambiguous`** flows. The inherited four-label prompt
  accepts ambiguous predictions, but this v6 screen does not test ambiguous
  truth recognition or abstention quality.

Raw responses, repairs, and scores go to `/tmp/f10-v6-glm5-defense.json`.
The runner writes a private `0600` atomic checkpoint after each seed; an
interruption may resume the same prefix with `--resume`, preserving earlier
model outcomes and the fixed seed order. Output paths inside the repository
are rejected. Record the final SHA-256, do not commit the raw capture, and do
not pool v5 defense metrics with this screen. The deterministic reference
run is a conformance check and is not a model result.
