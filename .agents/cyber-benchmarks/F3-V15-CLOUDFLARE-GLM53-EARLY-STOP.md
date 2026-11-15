# F3 v15 defense — GLM-5.3 early-stop result

Status: **the proposed ≤7/36 exact ceiling was disproved**. This is a
preregistered early-stop diagnostic, not an 18/36 or 36-case pass rate or a
release claim.

The frozen source, seeds, model settings, and stop rule are in
[`F3-V15-CLOUDFLARE-GLM53-PROTOCOL.md`](F3-V15-CLOUDFLARE-GLM53-PROTOCOL.md).
The excluded pilot reached the specified Cloudflare model, returned a valid
rule, and failed because its joins were ambiguous. The scored run stopped
immediately after its eighth exact pass. Eighteen of 36 planned cases
completed.

| Measure                            | Completed scored cases |
| ---------------------------------- | ---------------------: |
| Exact six-incident batches         |                   8/18 |
| Valid parsed rules                 |                  14/18 |
| Exact among valid                  |                   8/14 |
| Label-only exact batches           |                   8/18 |
| Incident labels correct            |                 48/108 |
| Malicious incident recall          |                  24/54 |
| False alarms on approved incidents |                   0/54 |
| Missing source/Job read proofs     |                    120 |
| Wrong source/Job read proofs       |                      0 |
| Missing joins                      |                      6 |
| Ambiguous joins                    |                     30 |
| Authorization errors               |                      0 |
| Truncated, unsubmitted responses   |                      4 |
| Provider or model-echo errors      |                      0 |

Among the **14 valid** rules, recall was 24/42 unauthorized incidents and
approved-case false alarms were 0/42. The all-case figures above include
four unsubmitted runs; neither zero false alarms nor the 18-case exact rate
should be presented as production precision or a 36-case estimate. By
controller setting, exact/completed was 3/6 `reconcile-hook`, 2/6
`mutating-webhook`, and 3/6 `owner-reference`.

## Trace-derived finding

The eight passing rules produced exact labels and both native read proofs
for every incident. A manually inspected passing rule used the causal
source writer, controller, action time, Job submitter, Pod service account,
signed template, and Job read time in the v2 authorization evaluation. Its
success was a genuine solve of the v15 contract, not a static answer key.

The six valid failures were five rules with ambiguous complete paths and
one with missing joins. They could not make unique authorization decisions;
their zero authorization-error count does **not** establish that scoped
approvals caused the misses. Four other runs exhausted the configured
16,384 completion-token ceiling, returned `finish_reason: length`, and
submitted no rule. One truncated on its first response; three truncated
after querying the evidence. Count these as invalid calibration runs, not
as security-reasoning failures. All 275 completed model turns had the
expected model echo when present, and there were no provider errors.

V15 added native, action-time approval scopes and is enterprise-plausible,
but GLM-5.3 solved it at least eight times under the fixed configuration.
The remaining single-target decision is the most useful next construct
pressure: the same admitted Job session already performs another completed
cloud read, yet v15 scores only the read matching the submitted resource.
The next candidate should evaluate authorization for each release-linked
completed read separately, with matched approved and unauthorized
counterfactuals, while preserving the source decision and the existing
portable estate. This is a fresh construct and requires a new frozen screen.

## Evidence and limit

- Scored raw capture (private, mode 0600):
  `/private/tmp/f3-v15-glm53-defense-33101-33112.json`.
- Scored raw capture SHA-256:
  `990d91b4926ab0c532d0690f01b6581504ba0087f6a248704a2aaa8638aafc9c`.
- Excluded pilot SHA-256:
  `52cca64658291c7e847e0427b2044d28fab6d1032002273aa2b74f474b7a2466`.
- Frozen source bundle SHA-256:
  `9d68362c386d9f50aec556f5173f117dcc23014e862f0c99fbd901b4deb8fc2a`.

Do not extend or resample these cases, report the early-stop numerator as
`8/36`, or claim a GLM-5.3 defense floor for v15.
