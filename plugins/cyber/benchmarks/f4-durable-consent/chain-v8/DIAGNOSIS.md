# F4 v7-to-v8 offline diagnosis

Date: 2026-11-14. This compares two completed, separately frozen
Cloudflare GLM-5.3 defense screens. V7 used seeds 15021–15029; v8
used seeds 16021–16029. Both crossed the same four families and
kept the v5 detector prompt, exact-map scorer, and low16 transport.
The v8 change added a balanced route/time near-match registry row to
each surviving grant in its native session. The model-visible
reference remained 36/36 exact in both versions.

| Measure                    | V7           | V8           |
| -------------------------- | ------------ | ------------ |
| Exact / 36                 | 14           | 18           |
| Valid output maps          | 31           | 33           |
| Valid but incorrect maps   | 17           | 15           |
| Format failures            | 5            | 3            |
| Provider / invalid errors  | 0 / 0        | 0 / 0        |
| TP / FP / FN on valid maps | 93 / 147 / 0 | 99 / 135 / 0 |
| Precision / recall         | 0.3875 / 1   | 0.4231 / 1   |
| Exact by family, T/I/A/P   | 3/5/5/1      | 4/5/5/4      |

The four additional exact maps comprise two fewer format failures
and two fewer valid model misses. The family difference is
concentrated in pagination truncation (1/9 to 4/9), with a one-case
gain in tenant boundary and no change in the other two families.
These are **unpaired fresh grids**, so the 14-to-18 difference does
not establish a causal effect of the added rows. It also does not
establish a stable capability improvement. Both scores missed the
pre-registered target of at most six exact maps.

The failure mode persisted. Every valid v8 miss marked all nine
authorized same-user survivors malicious while still catching all
three unauthorized survivors. V7 did this in 16 of 17 valid misses;
the other marked three authorized survivors malicious. All 72
requests in each screen received HTTP 200 on one physical attempt;
all model responses ended with `stop`, with no truncation. The
format failures in both screens were invalid label maps. The saved
model commands show the labels and read calls, not private reasoning,
so they cannot prove which individual registry row drove a label.

## Next task shape for review

Further per-grant near-match tuning is unlikely to test a new
operator decision. Both versions already ask for 13 separate labels,
and the repeated failure is a batch-wide false-alarm decision on
legitimate same-user grants. A more useful next _design question_ is
whether the defender can produce a **deployable remediation detection
rule** over the same model-visible estate: a parameterized query or
policy condition that flags surviving unauthorized grants while
preserving approved same-user activity. Evaluate that rule on a
fresh, hidden native estate with a separate false-positive budget,
without evaluator labels in the prompt or case-specific grant IDs
hardcoded into the submitted rule. Require the
rule to use the actual client/tenant/principal/scope/route/time
authorization join and to remain understandable to an enterprise
operator. Score execution of the submitted rule, not a prose claim
or a list of current grant IDs. Include negative tests for blanket
revocation and all-survivor allowlisting, and preserve the existing
offense and conditional-stage denominators.

This is a proposal, not a frozen candidate. It needs a separate
design review, offline visible-plane reference and no-oracle proof,
and explicit authorization for any live model call. No further F4
model call or DeepSeek call was made for this diagnosis. Formal G0–G7
and production release approval remain separate.
