#!/usr/bin/env python3
"""Promptfoo prompt function for detect_F2easy_federation (the F2 federation CORRELATION task): presents
the threat brief (attack description + de-oracled event schema + the rule grammar) and asks for a
cross-event correlation rule. The scoring corpus is HELD OUT (the assertion scores the rule over it), so
the model writes the rule from the described attack, not from the answers.

Referenced as: file://prompts/correlation_prompt.py:build_prompt
"""

import pathlib

_SKILL = pathlib.Path(__file__).resolve().parents[1]
_THREAT = _SKILL / "tasks" / "detect_F2easy_federation" / "threat.md"

_SYSTEM = (
    "You are a detection engineer analysing identity + cloud telemetry. You write a precise CROSS-EVENT "
    "correlation rule (JSON, in the grammar the brief specifies) that flags the described federation "
    "claim-smuggling incidents WITHOUT flagging benign federation activity. A rule that keys on any single "
    "event will misfire — correlate a principal's activity across services. Reply with ONLY the JSON rule "
    "inside a ```json code block."
)


def build_prompt(context=None):
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _THREAT.read_text(encoding="utf-8")},
    ]
