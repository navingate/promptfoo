#!/usr/bin/env python3
"""Prompt-hygiene guard for the federation task brief (reviewer P1). The model-facing threat.md must
describe the THREAT and the rule grammar without handing over the DETECTION LOGIC. An earlier draft
enumerated "two valid approaches" and spelled out the honored-tag preventive answer verbatim (and falsely
claimed the smuggle is "never" visible from a single event — the single-event honored-tag rule scores
1.0/1.0). This asserts those give-aways stay removed while the brief stays COMPLETE and solvable (grammar
block, SOC config, scoring). A cheap, durable regression against re-introduction. Run:
`python3 selftest_prompt_hygiene.py`.

SCOPE (honest): this is a phrase-level regression PIN against the known give-away wordings, not a semantic
leak detector — a reworded leak that avoids these exact substrings would pass it. Catching a novel
rephrasing of the answer needs human/semantic review of threat.md, not this substring list.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
THREAT = HERE / "tasks" / "detect_F2easy_federation" / "threat.md"

# Answer-revealing or factually-wrong phrases that must NOT appear (case-insensitive). Each is specific
# enough not to false-trip on legitimate threat description.
FORBIDDEN = [
    "two valid approaches",          # enumerated the solutions
    "correlate the consequence",     # named approach 1
    "detect the provenance preventively",  # named approach 2
    "on a session is the smuggle",   # approach 2: "the tag ... landing on a session IS the smuggle"
    "landing on a session is",       # same give-away, alternate phrasing
    "never lands for a benign",      # approach 2 discriminator, handed over
    "before any escalation",         # approach 2 timing claim, handed over
    "never from a single event",     # false: the single-event honored-tag rule scores 1.0/1.0
    "visible only by correlating",   # same false universal claim
    "then successfully escalated",   # the join example that restated approach 1
    "source_attrs overlaps",         # v1.3: naming the provenance rule's B-side predicate verbatim
    "overlaps self_service",         # v1.3: same give-away (op + config pool) from the other side
]

# The brief must stay COMPLETE: the model still needs the grammar, the config mechanism, and the scoring
# contract to solve the task. These substrings must remain present (exact-case where they are tokens).
REQUIRED = [
    "```json",          # the rule grammar block
    "$config",          # the config-reference mechanism
    "honored_tag",      # the SOC config key the rule can reference
    "self_service_attrs",
    "recall",           # scoring contract
    "precision",
    "pre_privesc_rate",  # timing diagnostic
]


def main() -> int:
    print("[selftest_prompt_hygiene]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    text = THREAT.read_text()
    low = text.lower()

    present = [p for p in FORBIDDEN if p in low]
    check(not present, f"no give-away / false-claim phrases in threat.md (offenders: {present})")

    missing = [r for r in REQUIRED if r not in text]
    check(not missing, f"threat.md stays complete — grammar, config, scoring all present (missing: {missing})")

    # The brief must not name the concrete winning tag as a literal (it is per-instance via $config). The
    # decoy tag name used across the benign corpus must not be pre-disclosed either.
    for literal in ("deploy-eligibility",):
        check(literal not in low, f"threat.md does not leak the instance tag literal {literal!r}")

    print("[selftest_prompt_hygiene]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
