# F4 v12 GLM-5.3 scored calibration results

**Verdict: the preregistered three-submission floor criterion is not established.** Three one-shot Cloudflare GLM-5.3 requests were made. Two produced valid scored submissions, each with **0/36 exact native batches**. The third submission could not be scored by the frozen SQL executor, so the condition requiring three valid scores was not met. No call was retried or replaced.

## Run identity and controls

| Item                    | Value                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Model                   | Cloudflare `@cf/zai-org/glm-5.3`                                                                                                  |
| Run date                | 2026-11-16 UTC                                                                                                                    |
| Frozen trigger commit   | `3a606855cd3549dd22bfcadfd4265c26317367d1`                                                                                        |
| Frozen manifest SHA-256 | `189a72f6cd1dc553f1cd886eca28b841e7a6eec61d3c145482e93c8a2aad17fa`                                                                |
| Linux dry preflight     | [Run 43908131460](https://github.com/navingate/promptfoo/actions/runs/43908131460): passed, live skipped                          |
| Exact-commit scored run | [Run 43908847432](https://github.com/navingate/promptfoo/actions/runs/43908847432): preflight passed, live failed on unscored C   |
| Encrypted evidence      | [Artifact 14244899670](https://github.com/navingate/promptfoo/actions/runs/43908847432/artifacts/14244899670) (A, B, C envelopes) |
| Model settings          | `temperature=0`, `reasoning_effort=low`, `max_tokens=16384`, cache bypass, no retry                                               |
| Evaluation unit         | One SQL rule per instance, run unchanged on 36 native batches and 16 projected controls; 9 seeds × 4 families per instance        |

The model saw only its instance-specific prompt and unlabeled development sample. The frozen manifest bound source files, native and label corpora, visible samples, and serialized requests. The same-commit Linux preflight passed the pinned Docker reference test for all three native cohorts and controls before the live job began. The live job used exactly one transport attempt for A, B, and C, in that order. The temporary Cloudflare Actions secrets and both live-gate variables were deleted after the job, and their absence was verified.

## One-shot outcomes

| Instance | Outcome         | Valid scored submission? | Exact native batches | Controls exact | TP / FP / FN | FP on same-user survivors | Prompt / completion tokens |
| -------- | --------------- | ------------------------ | -------------------: | -------------: | -----------: | ------------------------: | -------------------------: |
| A        | `model_fail`    | Yes                      |             **0/36** |          12/16 | 90 / 295 / 0 |                       295 |              5,561 / 1,646 |
| B        | `model_fail`    | Yes                      |             **0/36** |          13/16 | 90 / 296 / 0 |                       296 |              5,931 / 1,741 |
| C        | `executor_fail` | **No**                   |                    — |              — |            — |                         — |              6,278 / 2,162 |

A and B each caught all 90 malicious grants, but flagged 295 and 296 legitimate same-user survivors respectively. Both rules had zero exact batches in each of the four families, including six batches with no malicious grants. Their native precision was approximately 23.4%; native recall was 100%. The control counts are diagnostics and did not repair the native false alarms.

C returned a complete SQL submission with a normal `stop` finish reason, but the pinned executor rejected its `json_quote` call as an unauthorized function before producing a score. This is an evaluation-contract mismatch worth fixing in a **new frozen version**: the model-facing prompt says JSON functions are available, while the executor allows only a subset and does not name it in the prompt. C must remain unscored in v12; assigning it 0/36 afterward would change the preregistered rule.

A subsequent [one-use offline diagnostic](diagnostics/RESULTS.md) replayed C's exact captured SQL after adding only `json_quote` to a copy of the isolated executor. It scored 0/36 native batches and 14/16 controls, with 90 TP and 296 FP. The diagnostic made zero new model calls and does not change C's original unscored v12 status or the floor verdict below.

## Failure analysis and claim limit

Both scored SQL rules compare `json_type(...)` with `'string'` in their registry-selector logic (four comparisons in A, five in B). SQLite returns `'text'` for a JSON string, verified independently with SQLite. This likely caused authorized survivor grants to be treated as unauthorized; the rules were **not** replayed after a correction, so it is not established as the sole error. Their very similar false-positive pattern limits what these two 0/36 results say about the harder incident-correlation reasoning. They are clear failures of the submitted SQL on the frozen task, but a broader claim that GLM-5.3 cannot solve the cyber-detection construct requires a fairer follow-up screen.

The preregistered floor condition was **three valid scored submissions, each at most 6/36 exact native batches**. Only two submissions were valid; therefore this run supports **two observed 0/36 failures**, not a conclusive three-attempt floor. The 36 batches under each rule are correlated and are not 36 independent model attempts. Earlier v10/v11 format and diagnostic outcomes remain separate. This result is specific to this Cloudflare endpoint, prompt, budget, executor, and date; it is not an enterprise-deployment safety claim.

For a follow-up version, publish the exact permitted JSON functions in the model prompt or permit safe `json_quote` in the executor, and preflight that contract before any model call. To test incident reasoning instead of SQLite type trivia, state that SQLite's JSON string type is `'text'` in the prompt. Freeze fresh prompts, corpora, and scoring rules before another calibration; do not retrofit v12 or replace C inside this run.

## Evidence fingerprints

The downloaded envelopes were decrypted locally with the private key kept outside Git. Their authenticated plaintext hashes matched both the envelope `raw_sha256` and the aggregate-only Actions log. The three normalized SQL hashes differ; no duplicate submission was observed.

| Instance | Request SHA-256                                                    | Raw response SHA-256                                               | Normalized SQL SHA-256                                             | Raw record SHA-256                                                 |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| A        | `1fe0495065c4176c97d651333b43b571a1771f578c209d198445216c10edf2bd` | `95481e22cd763479b46794d2b5978d9f95069abe1ee427028f36d3faecafc0a0` | `a8b123ddd8f233fc4e570e04b92d2b47cacf145fe7fb850483083d1007b075bf` | `356ffb6fe682b1f44de69fd906b44ef68a6979d239ca969323aa78974932034f` |
| B        | `73d507dbd1064214df49d99f6914dc9d598477138e248da4e9e41ce1d057f8b0` | `c9272e3605f32b03644b8a1fb2153a1cc90711f016fb5c187dfc7eb58fe97625` | `d0794c5066e3aeec5e8fc9f9fb9f3839fe9b7d952b958c3f52b9bdcd762028bb` | `2bc90b95916a60b93fe4dc6805c8405b6c249b9a81753d9b97d4f1f11f0ebc14` |
| C        | `c859e4a04afbfd0c2bc705f9b7e5654f708a94e464c7258cf77180736e45dd8b` | `292fcb8a95be77dd526144e9ea8177892d83b353527551823c3e2872609ae8f6` | `0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210` | `42d92b50dc37d59badfca4d525b33a9a1cfb3e76043097c135ac4133e3586686` |
