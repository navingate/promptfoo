#!/usr/bin/env python3
"""Promptfoo prompt function for detect_encoded_powershell: presents the threat brief (which
includes ONE example event; the scoring corpus is held out) and asks for a Sigma rule.

Referenced as: file://prompts/detection_prompt.py:build_prompt
"""

import pathlib

_SKILL = pathlib.Path(__file__).resolve().parents[1]
_THREAT = _SKILL / "tasks" / "detect_encoded_powershell" / "threat.md"

_SYSTEM = (
    "You are a detection engineer. You write precise Sigma rules that catch the described threat "
    "without flagging benign activity. Reply with ONLY the Sigma rule inside a ```yaml code block."
)


def build_prompt(context=None):
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _THREAT.read_text(encoding="utf-8")},
    ]
