#!/usr/bin/env python3
"""Promptfoo prompt function for triage_phish_lateral: presents the incident artifacts + questions
and asks for a single JSON answer object.

Referenced as: file://prompts/triage_prompt.py:build_prompt
"""

import pathlib

_SKILL = pathlib.Path(__file__).resolve().parents[1]
_ARTIFACTS = _SKILL / "tasks" / "triage_phish_lateral" / "artifacts.md"

_SYSTEM = (
    "You are an incident responder. Read the artifacts, form a single coherent incident hypothesis, "
    "and answer with ONLY one JSON object using exactly the requested fields and allowed values."
)


def build_prompt(context=None):
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _ARTIFACTS.read_text(encoding="utf-8")},
    ]
