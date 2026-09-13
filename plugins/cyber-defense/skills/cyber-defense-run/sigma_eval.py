#!/usr/bin/env python3
"""A small, deterministic Sigma-subset evaluator for the detection family (Slice 2).

Full Sigma is large; per the design spec (§7B) v0.1 supports a documented RESTRICTED subset and
FAILS VALIDATION on anything outside it (never silently reinterprets). The matcher is pure and
stdlib-only — it takes an already-parsed rule dict + an event dict and returns a bool — so the
whole detection pipeline is stdlib-selftestable. Parsing Sigma YAML text into the rule dict needs
PyYAML (`load_rule`, the harness-venv edge); selftests build rule dicts directly.

Supported subset (raise SigmaUnsupported otherwise):
  detection:
    <selection-name>:                 # one or more named selection maps
      <field>[|<modifier>]: value | [values]
    condition: <expr>
  field modifiers: contains | startswith | endswith | re | all   (default: case-insensitive equals)
  a field's value list is OR (any) unless the field carries |all (AND across the list)
  a selection map matches an event when ALL its field-criteria match (AND)
  condition grammar: "sel" | "not sel" | "sel and sel" | "sel and not sel" | "all of them" | "1 of them"
"""

from __future__ import annotations

import re as _re


class SigmaUnsupported(ValueError):
    """The rule uses a construct outside the v0.1 supported subset."""


_MODS = {"contains", "startswith", "endswith", "re", "all"}


def _as_list(v):
    return v if isinstance(v, list) else [v]


def _atom_match(event_val, mod: str, target) -> bool:
    """Match one event field value against one target under a modifier (case-insensitive strings)."""
    if event_val is None:
        return False
    ev = str(event_val)
    t = str(target)
    if mod == "re":
        return _re.search(t, ev) is not None
    evl, tl = ev.lower(), t.lower()
    if mod == "contains":
        return tl in evl
    if mod == "startswith":
        return evl.startswith(tl)
    if mod == "endswith":
        return evl.endswith(tl)
    return evl == tl  # default: equals


def _field_match(event: dict, field: str, mod: str, values, all_values: bool) -> bool:
    ev = event.get(field)
    targets = _as_list(values)
    results = [_atom_match(ev, mod, t) for t in targets]
    return all(results) if all_values else any(results)


def _selection_match(event: dict, selection: dict) -> bool:
    for key, values in selection.items():
        field, _, modifier = key.partition("|")
        all_values = False
        mod = ""
        if modifier:
            parts = modifier.split("|")
            for p in parts:
                if p == "all":
                    all_values = True
                elif p in _MODS:
                    mod = p
                else:
                    raise SigmaUnsupported(f"unsupported field modifier: {p!r}")
        if not _field_match(event, field, mod, values, all_values):
            return False
    return True


def evaluate(rule: dict, event: dict) -> bool:
    """Return True iff the Sigma rule fires on the event. Pure; stdlib."""
    detection = rule.get("detection")
    if not isinstance(detection, dict) or "condition" not in detection:
        raise SigmaUnsupported("rule needs a detection block with a condition")
    condition = str(detection["condition"]).strip()
    selections = {k: v for k, v in detection.items() if k != "condition"}
    if not selections:
        raise SigmaUnsupported("no selections defined")

    def sel(name: str) -> bool:
        if name not in selections:
            raise SigmaUnsupported(f"condition references unknown selection {name!r}")
        return _selection_match(event, selections[name])

    toks = condition.split()
    if condition in ("all of them", "1 of them", "any of them"):
        hits = [_selection_match(event, s) for s in selections.values()]
        return all(hits) if condition == "all of them" else any(hits)
    if len(toks) == 1:
        return sel(toks[0])
    if len(toks) == 2 and toks[0] == "not":
        return not sel(toks[1])
    if len(toks) == 3 and toks[1] == "and":
        return sel(toks[0]) and sel(toks[2])
    if len(toks) == 4 and toks[1] == "and" and toks[2] == "not":
        return sel(toks[0]) and not sel(toks[3])
    raise SigmaUnsupported(f"unsupported condition grammar: {condition!r}")


def load_rule(yaml_text: str) -> dict:
    """Parse a Sigma YAML rule into a dict. Requires PyYAML (harness venv)."""
    import yaml  # deferred: selftests pass rule dicts directly

    rule = yaml.safe_load(yaml_text)
    if not isinstance(rule, dict):
        raise SigmaUnsupported("rule did not parse to a mapping")
    return rule
