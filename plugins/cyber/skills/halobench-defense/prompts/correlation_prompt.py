#!/usr/bin/env python3
"""Promptfoo prompt function for detect_F2easy_federation (the F2 federation CORRELATION task): presents
the threat brief (attack description + de-oracled event schema + the rule grammar) and asks for a
cross-event correlation rule. The scoring corpus is HELD OUT (the assertion scores the rule over it), so
the model writes the rule from the described attack, not from the answers.

Referenced as: file://prompts/correlation_prompt.py:build_prompt
"""

import json
import pathlib

_SKILL = pathlib.Path(__file__).resolve().parents[1]
_TASK = _SKILL / "tasks" / "detect_F2easy_federation"
_THREAT = _TASK / "threat.md"
_SOC = _TASK / "soc_config.json"

_SYSTEM = (
    "You are a detection engineer analysing identity + cloud telemetry. You write a precise CROSS-EVENT "
    "correlation rule (JSON, in the grammar the brief specifies) that flags the described federation "
    "claim-smuggling incidents WITHOUT flagging benign federation activity. A rule that keys on any single "
    "event will misfire — correlate a principal's activity across services. Reply with ONLY the JSON rule "
    "inside a ```json code block."
)


def build_prompt(context=None):
    brief = _THREAT.read_text(encoding="utf-8")
    try:  # append the concrete SOC config the rule may reference (the IdP self-service pool); the honored
        # tag VALUE is withheld so a preventive rule must reference it via {"$config": "honored_tag"}.
        soc = json.loads(_SOC.read_text(encoding="utf-8"))
        pool = ", ".join(soc.get("self_service_attrs", []))
        brief += (f"\n\n### SOC config values\n\n`self_service_attrs` = [{pool}]\n\n"
                  "`honored_tag` — value withheld; reference it in your rule as "
                  '`{ "$config": "honored_tag" }`, do not hard-code a tag name.')
    except Exception:  # noqa: BLE001 - the brief stands on its own if the config can't be read
        pass
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": brief},
    ]
