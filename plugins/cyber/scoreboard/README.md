# Cyber benchmark score registry

`scores.json` is the reviewed, versioned source for the F2–F11 dashboard. It
contains only aggregate results and immutable evidence links. It does not contain
private model transcripts, credentials, or raw captures. The family names follow
the authored suite design in `.agents/cyber-benchmarks/suite.yml` at the cited
benchmark commits.

The ten families have named offense and defense slots. F3 has separate **detection**
and **response adjunct** slots, because its v10.1 rule-and-proof task and v22
interactive containment task measure different constructs. F9's defense slot is
a response task. An absent `(family, slot, model)` current pointer means
**Pending**; it is never a zero score. F4 defense and the unscored GLM-5.3
F5–F8 and F11 slots are pending. The Qwen filter shows only the eight local
probes listed in the initial registry, including F11 defense's observed `0/8`.
Older F3, F4, F9, and F10 local probes are not selected as current. F3's
v23 GLM-5.3 response run is recorded as an inconclusive 8/14 stopped prefix
in history; v22's complete 11/36 remains current.

## Reading the numbers

Each current pointer selects one immutable run for a model and construct slot.
The score is the report's primary numerator over its stated denominator, in the
unit shown beside it. Offense, detection, conduct, and response scores are
different measures and must not be averaged or treated as a model safety
certification. The Qwen results are `local_probe` development observations,
not frontier ceiling runs.

For Qwen, `endpoint_id: openai-compatible` matches the provider identity in the
pinned calibration files. The specific server URL remains in those source
reports and is not duplicated in dashboard data.

Statuses are assigned during evidence review, not inferred from fractions:

- `release`: frozen, publicly shipped benchmark result.
- `scored_screen`: complete scored candidate run without release approval.
- `local_probe`: earlier development-model run that does not establish a
  frontier ceiling.
- `inconclusive`: observed fraction has a validity limit that prevents the
  intended capability claim.

In particular, F3 detection's `7/36` exact rule-and-proof count is descriptive:
only `11/36` batches had valid parsed rules, below its 30-batch gate. It stays
`inconclusive`; the separate F3 response adjunct is `11/36` scored. F10 offense
uses **36 planned cases** as the primary denominator even though only 28 had
valid final decisions: seven ended off grammar and one had a provider error.
Its `5/36` and conditional `5/28` answer different questions. F2 defense uses
a synthetic value-symmetric scoring corpus; its nine grounded captures are
conformance evidence rather than scored cases. The `scored_at` field is `null`
when the report does not state a run date; `evidence_committed_at` records the
separate commit date.

## Publish a future result

1. Review the completed scored report and its frozen candidate. Confirm the
   exact model and endpoint IDs, candidate version, primary metric and unit,
   numerator and denominator, validity/error counts, status, and caveat. Use a
   report URL pinned to a 40-character commit in the public fork. Inspect its
   committed bytes with `git show <evidence-commit>:<path>` and record the
   candidate's source commit. Use a scored date only when the report states one;
   otherwise set `scored_at` to `null`. Never publish raw output or a private
   trace as the evidence URL.
2. Write a small JSON submission containing a normalized `run` object with the
   same fields as existing records. Choose a unique `run_id` and match the
   existing family, side, `slot_id`, `construct_id`, and `metric.id`. For a new
   construct, also include a `slot` object; the publisher appends it to that
   family. Existing runs, family identities, and slot definitions are immutable.
3. From the repository root, add the reviewed run and explicitly select it if
   it should become the current result for that model and slot:

   ```bash
   python3 plugins/cyber/scoreboard/scoreboard.py add \
     --registry plugins/cyber/scoreboard/scores.json \
     --input /path/to/submission.json --current
   python3 plugins/cyber/scoreboard/scoreboard.py validate \
     --registry plugins/cyber/scoreboard/scores.json
   ```

   Omit `--current` to append history without replacing the selected result.
   The publisher validates shape, bounds, evidence URL, pointer alignment, and
   append-only history, then writes the registry atomically. Its persistent
   `.scores.json.lock` protects concurrent writes and is gitignored.

4. Review the `scores.json` diff against the pinned report. Commit the registry
   on a feature branch, push it to the fork, and open or update a PR. Do not
   rewrite an earlier run to correct a result; append a new reviewed record and
   select it explicitly. The Site reads committed registry data and refreshes
   on load, focus, and its interval. It cannot see local or uncommitted
   calibrations, and no Site rebuild is needed for a score update.

For a quick check of the publisher itself, run:

```bash
python3 plugins/cyber/scoreboard/selftest_scoreboard.py
```
