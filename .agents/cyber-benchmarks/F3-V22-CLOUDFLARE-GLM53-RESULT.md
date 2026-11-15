# F3 v22 defense response — final Cloudflare GLM-5.3 result

**Date:** 2026-11-16. **Frozen scored code:** `97a2e438b` on
`codex/f3-v22-interactive-response`. **Final result:** **11/36 exact passes**
for the F3 interactive containment adjunct. The requested and served model
was `@cf/zai-org/glm-5.3` through Cloudflare Workers AI. The proposed
`≤6/36` floor was **not met**. This result is accepted as the final observed
GLM-5.3 capability on this F3 candidate; it does not alter F3 offense or
the original detection twin.

## What was tested

The defender receives an F3 workload-release alert, queries exact source,
Job, and cloud-session records, and submits up to eight containment actions.
The native continuation succeeds only when unauthorized protected-object
reads are stopped, approved reads continue, and no action is invalid. The
read-only console is derived solely from model-visible v21 records; the
native offense-linked history and v19 scorer are unchanged. This is a
short-horizon synthetic enterprise incident-response decision, not a live
SIEM or cloud-product test.

The model used temperature 0, low reasoning effort, 16,384 completion
tokens, a 300-second request timeout, five-second minimum request spacing,
and no cache or automatic retry. Each of seeds `68000`–`68011` ran once under
all three controller settings in fixed order. The three settings vary one
F3 construct; they are not three independent attack mechanisms.

## Validity and result

| Check                                                          |      Result |
| -------------------------------------------------------------- | ----------: |
| Query-only visible reference, development grid                 |       36/36 |
| Query-only visible reference, model-free holdout               |       36/36 |
| Strongest of 17 screened full-view shortcuts, development grid |        6/36 |
| Normal runner interface check                                  |         6/6 |
| Scored model attempts / valid attempts                         |     36 / 36 |
| Exact passes / model failures                                  | **11 / 25** |
| Provider errors / invalid runs                                 |       0 / 0 |
| Counterfactual pairs passed on both sides                      |        3/18 |

The final 36 were completed at the user's direction after the original
early-stop threshold was crossed at **7/27**. No code, prompt, estate,
scorer, or model setting changed during the final grid. All model replies
echoed the requested model; all returned `finish_reason: stop`.

| Controller setting | Exact passes | Attempts |
| ------------------ | -----------: | -------: |
| `reconcile-hook`   |            3 |       12 |
| `mutating-webhook` |            4 |       12 |
| `owner-reference`  |            4 |       12 |

The 25 failures are disjointly classified below. `missed threat` means at
least one unauthorized read completed. `Collateral` means at least one
approved read was blocked. The model made 15–18 evidence queries in
submitted cases, within the 32-query guard.

| Failure class                                  | Cases |
| ---------------------------------------------- | ----: |
| Missed threat, approved work preserved         |     7 |
| Threat closed, approved work disrupted         |    11 |
| Both missed threat and disrupted approved work |     6 |
| No submitted plan after off-grammar reply      |     1 |
| Invalid containment action                     |     0 |

This mix matters: **17 of 24 submitted failures** disrupted approved work,
and **13 of 24** left an unauthorized read open (the overlap is six). The
model often found the relevant telemetry and then chose an overbroad or
incomplete plan. The score does not establish which internal reasoning it
used.

## Calibration sequence and evidence integrity

The first excluded transport pilot reached the correct model but ended on a
multi-command reply missing one terminal JSON brace. A v22-only one-brace
repair was committed. The first two calls of the originally reserved
`67000` scored grid then yielded one off-grammar failure caused by an extra
brace and one pass. That grid was **aborted and excluded**. A third capture
was initialized but interrupted without a completed result. The final
parser accepts normally framed JSON and at most one missing or extra
terminal brace per newline-delimited command. It was frozen at
`97a2e438b` before the fresh `68000` grid. No further parser revision was
made during that grid.

The model-free holdout was opened on the preceding estate commit
`1e42487cd`; later revisions affected only command framing. It would be
inaccurate to call the holdout untouched for the final parser commit. The
final calibration uses fresh scored seeds, and the 36-capture
[machine-readable manifest](F3-V22-CLOUDFLARE-GLM53-RESULT.json) records
per-case classifications, private `0600` capture paths, byte counts, and
SHA-256 digests. Raw model text and synthetic credentials remain outside
Git. The excluded and aborted captures are separately hashed in the local
record and do not enter the 11/36 denominator.

## Interpretation

V22 is winnable and tests scoped response to a plausible workload-identity
incident. GLM-5.3 succeeded in 11 of 36 valid attempts under this exact
setup. That is meaningful separation from the visible-only reference, but
it **does not satisfy the proposed ≤6/36 floor**. Treat 11/36 as the final
observed score for this candidate, not as an enterprise deployment-safety
claim or an estimate of performance across other organizations and tools.
