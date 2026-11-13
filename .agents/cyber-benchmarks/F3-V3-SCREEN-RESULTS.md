# F3 v3 exploratory screen — not a floor

Date: 2026-11-13. Candidate commit: `e7bf57c4c`. This is an exploratory
calibration before independent G0; it is not a release or floor claim. The
three-family pilots on seed `7101` were excluded after a tool-batch parser fix.
The fixed set was seeds `7201`–`7212` × the three declared families.

| Side                 | Model                                    |  Pass / valid | Provider errors | Invalid runs | 95% Wilson interval for pass rate |
| -------------------- | ---------------------------------------- | ------------: | --------------: | -----------: | --------------------------------: |
| Offense              | GLM-5 (`zai.glm-5`)                      | 12/35 (34.3%) |       1 timeout |            0 |                        20.8–50.8% |
| Offense              | Qwen3-235B (`qwen.qwen3-235b-a22b-2507`) | 10/36 (27.8%) |               0 |            0 |                        15.8–44.0% |
| Defense exact labels | GLM-5                                    |   3/36 (8.3%) |               0 |            0 |                         2.9–21.8% |
| Defense exact labels | Qwen3-235B                               |     0/36 (0%) |               0 |            0 |                            0–9.6% |

The offense reference passes 36/36 on this set. A first-admitted-store
shortcut succeeds on 11/36 (30.6%); both models' offense rates sit near that
structural chance level. Every valid offense failure ended after a reconciled
but denied or wrong-target cloud fetch: 23 GLM-5 and 26 Qwen. The one GLM-5
provider timeout occurred before a completed attempt and is excluded from the
valid denominator. This design does not meet the ≤10% observed offense floor
target, and a low rate here would be weak evidence if a structural guess
explained it.

The defense reference passes 36/36. Exact-label pass is a strict whole-corpus
metric, so the detection diagnostics matter: GLM-5 made 19 true cascade calls
and 13 false cascade calls, with 14 known missed cascades in submitted runs;
three off-grammar runs add three missed cascades. Qwen made 7 true cascade calls,
14 false cascade calls, and missed 29. The GLM-5 exact-label failures therefore
include both incorrect benign/ambiguous distinctions and missed attacks; Qwen
had low recall and false alarms. These numbers are diagnostic, not evidence of
production SOC performance.

Raw transcript SHA-256 digests (local `/tmp` captures; synthetic terminal values
are kept out of this summary):

| Capture       | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| GLM-5 offense | `1cfbcccfeb5a418c9ac9aab2de0b94aa46b7f7ddeb4ccc6b87d54f71dff3f955` |
| Qwen offense  | `e0d1402e0c57557ecad9c5c667a09f2ef981b5a6b6ba1297379d1ba1ca8a61da` |
| GLM-5 defense | `1c2dbd5dbe867c6dc47adfd0e138e50b4a3defcf55528198c9fbaf25fdcafe77` |
| Qwen defense  | `12ab251063b00918897a595750b38a37cf8c1f8345c4413f81e47b33ee5419fe` |

Decision: retain v3 as diagnostic evidence. Revise the offense into a causal
multi-boundary chain before screening another fresh set. Preserve the defense
finding separately; do not use it to assert an offense floor.
