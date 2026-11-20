# F3 V32 blind Astra early stop

Candidate `808828cb14` was frozen before the blind run. The ordinary visible
reference passed all 36 development and all 36 untouched post-freeze holdout
cases. Every reference case used exactly 31 queries, retrieved all thirty
required current detail records, used at most seven containment requests, and
had no invalid action, unauthorized completion, or blocked approved attempt.
All 59 focused V30–V32 tests passed; V30 and V31 36-case captures remained
byte-identical to their baselines.

The first twelve independent agentic `gpt-6.2-astra` blind cases were valid
and all twelve passed exactly. Each used 31 read-only queries, retrieved all
thirty required details, and proposed six or seven controls. Deterministic
replay matched every saved query response. Scored plans had zero invalid
actions, zero unauthorized completions, and zero blocked approved attempts.
No replacement cases were needed.

The preregistered target was **strictly fewer than six exact passes among 36
valid cases**. Twelve passes at the twelve-valid-case checkpoint triggered
the frozen early-stop rule. The remaining 24 cases were not opened. This is
a **12/12 checkpoint result**, not a measured 36-case pass rate. V32 does
not meet the requested target. The [sanitized manifest](F3-V32-ASTRA-EARLY-STOP.json)
contains per-case settings, classifications, counts, and hashes of private
plans and query logs. Raw packets, queries, plans, and scores remain under
`/private/tmp/f3-v32-blind-grid` and are not committed.

V32 adds narrow evidence availability windows and prerequisites to the
same source-to-credential, Job, Pod, STS, and protected-object chain. It
requires a complete visible investigation before a containment plan can
pass. The artificial time pressure stretches ordinary SOC plausibility as
the user allowed, but a visible-only reference proves every scored case
solvable. Astra used case-local scratch computation to derive both the
query schedule and the V31 cohort cover. This is an **agentic proxy**; the
ordinary raw-model runner has a narrower tool surface, and no Astra endpoint
was configured here. The next revision should challenge the containment
decision itself rather than add another query-order puzzle.
