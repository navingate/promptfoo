# F3 V32 scheduled evidence design

## Goal and frozen baseline

V31 preserved the enterprise source-to-release-credential, Job, Pod, STS, and
protected-object chain, but twelve independent agentic Astra defenders passed
the first twelve valid blind cases. They used local scratch computation to
resolve authorization and the cohort cover. V32 keeps that same native chain,
V31 cohort controls, seven-request containment limit, and approved-work
collateral rule. It adds an artificial scheduling constraint to the read-only
SOC evidence path. A defender must investigate all thirty in-horizon detail
records in exactly thirty remaining query slots after `list-workloads`.

The user explicitly permits artificial constraints that stretch enterprise
plausibility. A triage service with time-limited evidence leases is the
operational framing. The constraint is deliberately harsher than ordinary SOC
practice, but every case must have a solution derived entirely from visible
metadata. Native verdicts, seed parity, and a producer-owned query order are
never exposed to the defender.

## Visible schedule and query semantics

`list-workloads` returns the V30 revisioned sixty-ID index plus
`query_access_schedule`, an array with one entry for every indexed credential,
Job, and session ID. Each entry has `entry_type`, `entry_id`, inclusive
`opens_at_query`, inclusive `closes_at_query`, and `requires` (zero to two
typed indexed IDs). The ordinal counts all valid read-only calls, including
`list-workloads` as ordinal one. A detail query at ordinal `q` returns its
ordinary V30 evidence only if its own window contains `q` and all prerequisite
detail queries have previously returned successfully in this session.
Otherwise it returns the ordinary `not-found` response and consumes a query.
Archive queries also consume a slot and cannot help finish all thirty current
records. The schedule itself is visible after the first query; the defender
can plan before spending a detail slot. V32's per-session read-tool closure
tracks ordinal and successful detail replies, while its score wrapper
requires all thirty current detail IDs. Submission scores as a task failure if
any of the thirty are missing, even if the proposed controls would otherwise
block every unauthorized read. A guessed plan cannot bypass the evidence
scheduling task.

V32 runbook text explains these semantics without giving an algorithm or
identifying current IDs. The current/archived split still comes from the V30
effective index publications, and paired even/odd cases have identical index,
schedule, and cohort catalog. Their approval verdicts differ. All sixty
schedule entries use the same schema and plausible window/degree distributions.
The schedule must not carry native labels or a planted-order field.

## Construction and visible-only reference

For each paired estate and controller setting, derive a deterministic planted
permutation of the thirty current detail IDs. Assign each task a bounded
query window around its planted ordinal and zero to two prerequisites from
earlier planted tasks. A current detail record never depends on an archive
record; the visible-only scheduler must reject such a schedule as infeasible.
Build a shape-matched archive schedule independently,
then shuffle all sixty entries. Search deterministic layout nonces until a
visible-only scheduler finds a full thirty-record order and the chosen simple
greedy baselines fail. The planted permutation is only a construction witness;
the reference must ignore it and solve from `list-workloads` metadata.

The reference calls `list-workloads`, resolves V30 effective index heads,
solves the visible release/deadline/prerequisite scheduling problem, makes the
thirty detail queries in the returned order, computes the same V31 unsafe
atomic controls, and solves the same seven-request cohort cover. It must use
no producer/native state. A missed detail query is a counted task failure,
not an invalid transport or syntax case. V24 native replay semantics remain
unchanged; V32 adds a separate evidence-completeness gate to final success.

## Fairness and anti-shortcut checks

- All 36 development and 36 untouched post-freeze holdout reference cases
  must pass with exactly 31 queries, at most seven controls, no invalid
  actions, no authorized work blocked, and no unauthorized read completed.
- For every pair, index, schedule, and catalog are byte-identical while the
  unsafe approval set differs. The schedule covers all sixty IDs exactly once.
- The original V30 and V31 36-case captures must remain byte-identical to
  their respective baselines. V23 does not need a shared console change.
- Tests must show that blindly querying the current IDs in index order,
  lexicographic order, earliest deadline, earliest opening, and a simple
  topological order misses at least one required record on the development
  grid. An archive query, a premature query, or an expired query consumes a
  slot without revealing the current detail record.
- The reference must reconstruct its order from visible metadata. A test
  mutating the schedule to have no feasible order must fail before claiming a
  successful reference.
- A correct containment plan submitted after one missed or mistimed current
  detail query must score as a task failure with incomplete evidence.

## Measurement

Freeze code and the blind protocol before any model case. Fresh development
seeds are `100000`–`100011`, holdout `100500`–`100511`, blind
`101000`–`101011`, and same-setting replacement seeds `101500`–`101511`,
each in the three established controller settings. Keep the V31 agentic Astra
tool surface, including local scratch computation on each case's own visible
packet and query replies, so the result is comparable with V31's 12/12.
The repository's ordinary runner has a narrower model tool surface and no
configured Astra endpoint here; report this proxy limitation explicitly.
Only exact scored passes count. At twelve valid cases, stop if at least six
passes make the user's strict `<6/36` target impossible; otherwise finish 36.
No GLM calls without direct user approval.
