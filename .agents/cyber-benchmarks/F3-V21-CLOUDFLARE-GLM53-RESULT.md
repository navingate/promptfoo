# F3 v21 defense response — Cloudflare GLM-5.3 result

**Date:** 2026-11-15. **Candidate commit:** `464d4e84e`. **Outcome:** valid,
offense-anchored response candidate; **the proposed GLM-5.3 floor was not
met**. This result applies to the v21 incident-response adjunct, not F3
offense or the original `cascade-correlation` detection twin. The
[machine-readable record](F3-V21-CLOUDFLARE-GLM53-RESULT.json) contains the
counts and capture hashes for a future benchmark dashboard.

## What changed

V21 selects four or five native F3 release histories plus a scheduled Job,
including both compromised source histories. It varies current Job approvals
and active/renewal plans, and pairs adjacent seeds that differ by one
observable current approval. Neighboring source mappings create plausible
same-secret background activity around a compromised and an approved
release. The native scorer is unchanged from v19; the v20 visible-only
reference handles the larger cohort. This remains a simulated enterprise
estate with a synthetic response continuation, not a captured production
incident.

## Local validity and shortcut checks

| Check                                                       |                                                          Result |
| ----------------------------------------------------------- | --------------------------------------------------------------: |
| V18–v21 tests                                               |                                                      89/89 pass |
| Ordinary runner, reference mode                             | 6/6 pass on the paired smoke test; 4/4 on fresh interface cases |
| Visible-only reference, development A (`56000`–`56011`)     |                                                           36/36 |
| Visible-only reference, development B (`57000`–`57011`)     |                                                           36/36 |
| Visible-only reference, untouched holdout (`62000`–`62011`) |                                                           36/36 |
| Strongest of 17 visible-only shortcuts, each grid           |                                                            6/36 |
| Action budget / reference maximum                           |                                                           8 / 5 |
| Visible evidence size on development A                      |                                             74,484–96,049 bytes |

Development B was inspected during generator iteration, so it is **not** a
holdout. The `62000` grid was opened once after the candidate commit. The
17 shortcut planners cover list position, blanket controls, first/last and
second-last source fetches, inverted fetch choices, extra-mapping placement,
and any/all/majority unauthorized-fetch aggregation. Their low scores show
that those specific proxies do not explain a high model score; they do not
prove the absence of every possible shortcut. One blanket-control baseline
also exceeded the action budget in 20 holdout cases; its zero pass rate is
therefore not independent evidence of difficulty.

## Frozen model screen

Cloudflare Workers AI returned the requested and served model
`@cf/zai-org/glm-5.3` with temperature 0, low reasoning effort, a 16,384
completion-token cap, a 300-second request timeout, five-second minimum
request spacing, no response cache, and no automatic retries. All model
responses in this screen had `finish_reason: stop`. Raw captures have mode
`0600` and stay outside the repository.

| Stage                                                    | Completed |  Pass | Model fail | Provider error | Invalid run |
| -------------------------------------------------------- | --------: | ----: | ---------: | -------------: | ----------: |
| Excluded transport pilot (`59000/reconcile-hook`)        |         1 |     1 |          0 |              0 |           0 |
| Fixed six-case diagnostic (`59012`–`59013` × 3 settings) |         6 |     1 |          5 |              0 |           0 |
| Reserved scored grid (`60000`–`60003` × 3 settings)      |        12 | **7** |          5 |              0 |           0 |

The diagnostic met the preregistered condition to start the scored grid.
The scored run then reached **seven passes after 12 valid cases**, exceeding
the proposed ceiling of six passes in 36. The runner completed that
three-setting seed and stopped; `60004`–`60011` were not run. **7/12 is the
observed early-stop count, not a 36-case success-rate estimate.** The
`≤6/36` floor is disproved for this candidate regardless of the unrun cases.

The five scored failures were mixed: three left at least one unauthorized
source-backed read open, one interrupted two approved reads, and two had an
invalid action (one of those also left a threat open). These categories
overlap. In the seven passing cases, submitted plans contained every
reference-critical control; some added controls on already unsafe Jobs
without blocking approved work. The model output commands rather than an
explanation, so the traces show **what it did**, not whether it used the
intended causal reasoning or an untested proxy.

## Private capture integrity

| Capture                                                 |     Bytes | SHA-256                                                            |
| ------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `/private/tmp/f3-v21-glm53-excluded-pilot-59000.json`   |   187,712 | `547db994765a1deee39343fff573a5c886180b2ce607fa4b4efece0e4d0be961` |
| `/private/tmp/f3-v21-glm53-diagnostic-59012-59013.json` | 1,041,307 | `827392de27ea07d9ab38227fee78762682351c1729a49669c63871f9f43f7292` |
| `/private/tmp/f3-v21-glm53-scored-60000.json`           |   498,671 | `a036b94c05b9f3b4523bba9b6c5710f796357b5303a4864e4f24275a8555de7f` |
| `/private/tmp/f3-v21-glm53-scored-60001.json`           |   512,116 | `2946cc1362773814d3ea1f0b14a2143626fae0d1c1fe27213644e01cf86e80e1` |
| `/private/tmp/f3-v21-glm53-scored-60002.json`           |   501,596 | `d467d77740e2975ffdf0f151df8268c92d35102beecbd131910dd3e475e25797` |
| `/private/tmp/f3-v21-glm53-scored-60003.json`           |   503,722 | `4401b412c8865d14a993fe26c5bc082b44ad04951ae82f1ef23cad7d1aa78171` |

## Decision

Retain v21 as a valid, more variable F3 response candidate and record this
failed floor attempt. Do not present it as a floored GLM-5.3 defense chain.
The result also argues against further seed tuning or more decoy volume as
the next move. A future revision should change a real response decision in
the same workload-identity incident, specify its observable evidence and
function-preservation boundary first, and receive a new design review before
calibration. No enterprise deployment-safety claim follows from this one
model and one simulated estate.
