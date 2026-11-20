# F3 V31 overlapping containment cohorts

V31 keeps V30's revisioned sixty-ID SOC index and thirty-one-query budget. It
adds ninety-six overlapping containment cohorts over the forty-eight indexed Job
UIDs and session access-key references, including archive IDs. The catalog is
visible at the start; the current versus archive status comes from ordinary
read-only evidence.

`quarantine-cohort {cohort_id}` atomically pauses selected current Jobs and
denies selected current issued sessions. Archive selectors have no effect.
Selecting approved current work fails containment. Individual Job pauses,
session denials, and role revocations remain available. The console accepts
seven total control requests, so a safe plan must combine cohorts and exact
controls while preserving approved work.

The reference uses the same thirty-one read-only queries available to the
defender. It derives exact controls from those replies and solves a safe cover
using the visible catalog. Native replay expands cohorts privately before
scoring future reads.

See the [design](../../../../../docs/superpowers/specs/2026-11-20-f3-v31-cohort-containment-design.md).
