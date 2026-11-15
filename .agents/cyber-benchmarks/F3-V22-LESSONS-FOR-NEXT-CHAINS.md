# F3 v22 lessons for the next enterprise chains

**Use this note before changing F4, F9, F10, or a later defensive twin.**
The evidence is the frozen [F3 v22 result](F3-V22-CLOUDFLARE-GLM53-RESULT.md)
and its [machine-readable capture manifest](F3-V22-CLOUDFLARE-GLM53-RESULT.json).
It is an observation from one model and one simulated estate, not a universal
recipe for making models fail.

## What worked in the benchmark design

1. **Keep the incident and outcome native.** V22 retained the F3 offense-linked
   source → release credential → Job → Pod → cloud-session history and the
   v19 continuation scorer. A query tool could reorganize published evidence
   but could not manufacture authorization or outcome facts. The full-view
   reference and the query-only reference both solved the 36-case grids.
2. **Make the response choice two-sided.** Stopping the attacker alone is
   insufficient when a same-role approved Job has a planned read. Broad
   revocation and blanket pause had real native collateral. In the final
   GLM-5.3 run, 11 of 24 submitted failures were collateral only and six
   both missed a threat and caused collateral. This exposed a genuine
   decision error rather than simply making log lookup harder.
3. **Use policy-relevant counterfactuals.** Paired even/odd cases share
   historical source and session activity but differ in one current Job
   grant. The correct action changes for that Job. Only 3/18 model pairs
   were correct on both sides. This is stronger evidence than adding
   unrelated decoy rows.
4. **Keep the console adoptable.** Four exact-ID read tools, no external SIEM,
   32 generous queries, and the unchanged eight-action plan were enough to
   test investigation and response. Reference runs used 15–18 queries;
   query scarcity did not create difficulty.
5. **Preserve model-free gates.** The visible-only reference passed 36/36 on
   development and holdout; the strongest of 17 tested full-view shortcuts
   passed 6/36 on development. These checks establish winnability and rule
   out the screened proxies, not every possible shortcut.

## What not to repeat

1. **Do not teach the exact joins in the model guide.** V21 exposed a complete
   74–96 KB view and a step-by-step causal-join recipe; GLM-5.3 reached
   seven passes after 12 valid scored cases. V22 gave policy semantics and
   action effects, while requiring the model to retrieve and connect
   records. It still passed 11/36, so interface changes alone are not a
   guaranteed floor.
2. **Do not confuse syntax errors with security difficulty.** The first
   excluded pilot and aborted scored grid exposed one missing and one extra
   terminal JSON brace in multi-command replies. The runner was repaired
   narrowly and a fresh scored grid was frozen. Future chains should test
   one-command, newline-batched, fenced, and near-valid command framing in
   an excluded pilot before opening scored seeds. Count residual formatting
   failures separately in the final report.
3. **Do not stop at a favorable partial denominator.** The preregistered
   stop at seven passes occurred at 7/27; the user asked to complete all 36,
   producing 11/36. State both facts and the change in protocol. A partial
   early-stop count is not a 36-case success rate.
4. **Do not overstate the setting count.** F3's three controller names vary
   one construct. They do not represent three independent enterprise
   environments. A low score on this synthetic response slice cannot prove
   safety to deploy in an arbitrary estate.
5. **Do not tune further once the final result is accepted.** V22 did not
   meet the proposed ≤6/36 ceiling, but its final 11/36 score is an honest
   capability measurement. Further hardening would be a new candidate and
   require new design, seeds, and model calls.

## Hand-off to the next chain

F4 Durable Consent is the next clear offense/defense gap. Its completed
GLM-5.3 offense screen was **2/36** full-chain successes, while the last
completed defense screen was **18/36** exact. A newer F4 v10 one-call SQL
detection candidate exists but has no live model score. Start by validating
its executor and model-visible evidence on the pinned Linux/Docker setup,
then screen the frozen candidate. Do not redesign F4 from F3's result alone:
inspect F4's own traces, shortcut audit, and legitimate same-user survivor
class first. F10 is another candidate (offense 5/36, defense 8/12), but F4
has the larger measured defense gap.
