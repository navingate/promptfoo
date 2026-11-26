# F10 v17 first blind Astra diagnostic

The first frozen v17 batch was **1/1 exact**, with 19/19 flow labels correct: four cumulative exfil, seven sanctioned bulk, one ambiguous registry outage, and seven benign. The answer included the per-delivery overlap boundary and the complete-registry dangling-citation boundary. There were zero invalid outputs, provider errors, repairs, or model tool items. This is a single pilot case, not a floor or a multi-seed ceiling claim. No further model calls were made after this result.

## Binding

| Item                      | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| Candidate source commit   | `5e0427ed3388c6a71c5ef38dfdf928855035423b`                            |
| Frozen evidence commit    | `1491d327d933f789ea96139d907a2fc4cd74fdc8`                            |
| Evidence manifest SHA-256 | `7e34e84475c29e520f25075f030e3de58eba5a77a21e111ec9bb83bea0c26a8a`    |
| Batch                     | `0`, capacity seed `52001`, overlap seed `51001`                      |
| Pilot input SHA-256       | `626d5d6de63e7228b17cfa63f4bb5eb43d15eb29e752f4f3795af96bfabae232`    |
| Raw response SHA-256      | `74a53460576492c976e3dff4a5a69c4718aef07460dff54be509097351b82195`    |
| CLI event log SHA-256     | `29cd4472568eb365eec3a065da0c0ef387d1bda927e8a20eb09a2bafc5665599`    |
| Raw record location       | `/private/tmp/f10-v17-astra-7MjcGJ/` (outside Git, mode `0600` files) |

Codex CLI `0.167.0` requested `gpt-6.2-astra`, high reasoning, `--cyber-access-program standard`, `--sandbox read-only`, `--ignore-user-config`, and an isolated temporary working directory. The model received the frozen prompt and `observation-0.json` only. Its CLI event log contains one agent message and a completed turn, with no tool item. The requested Standard setting is evidence of the client route; the service-side effective setting was not independently attested. The input used 97,884 tokens, which is high for a lightweight benchmark.

## Model-free evidence and decision

The frozen 12-batch candidate has 228 completed flows and a 12/12 exact visible-only reference. All 15 screened shortcuts scored 0/12 exact, including the earlier covered-anywhere detector. Native proof replay, observation hashes, answer hashes, and prompt hash matched the source and manifest. The pilot shows that at least one fresh case is readily solvable by Astra under the supplied visible rule. It does not justify a 36-case floor run. The next design review should ask whether the task can introduce a consequential, realistic authorization state change or verification step while preserving sanctioned exports, rather than adding opaque arithmetic or penalizing this correct answer.

V13, v15, and v16 scores and raw records remain frozen. GLM calls remained paused. G0 semantic review and release gates remain open.
