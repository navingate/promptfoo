# F3 V33 blind Astra early stop

Candidate `e7db440d1c1fd860bb5554518a56157edb81e5a0` was frozen before
the blind run. The visible reference passed all 36 development and all 36
untouched post-freeze holdout cases. Every reference case used 31 read-only
queries, retrieved all thirty required current detail records, used four
containment requests, and had no invalid action, unauthorized completion, or
blocked approved attempt. Focused V33 tests passed, and the V30–V32 36-case
captures remained byte-identical to their baselines.

The first twelve independent agentic `gpt-6.2-astra` cases, run at high
reasoning effort with case-local scratch computation, were valid and all
twelve passed exactly. Each used 31 queries and four controls. Deterministic
replay matched the saved query responses. Scored plans had zero missing
required evidence, invalid actions, unauthorized completions, or blocked
approved attempts. No replacement cases were needed.

The preregistered target was **strictly fewer than six exact passes among 36
valid cases**. Twelve passes at the twelve-valid-case checkpoint triggered
the frozen early-stop rule. The remaining 24 cases were not opened. This is a
**12/12 checkpoint result**, not a measured 36-case pass rate. V33 does not
meet the target. The [sanitized manifest](F3-V33-ASTRA-EARLY-STOP.json)
contains per-case settings, classifications, counts, and hashes of private
plans and query logs. Raw packets, queries, plans, and scores remain under
`/private/tmp/f3-v33-blind-grid` and are not committed.

V33 preserves the source-to-release-credential, Job, Pod, STS session, and
protected-object chain. The catalog adds coupled quarantine and exception
controls under a four-request emergency window. This remains solvable by the
visible reference and stretches enterprise plausibility within the user's
stated allowance. Astra consistently used the full evidence schedule,
classified both planned reads for each Job, and selected a valid four-control
plan. The next candidate should change this direct classify-then-cover path.
This is an **agentic proxy**; the ordinary raw-model runner has a narrower
tool surface and no configured Astra endpoint here.
