#!/usr/bin/env python3
"""Offline selftest for the AGENTIC correlation provider (correlation_agent_provider.py). Mocks the model
turns (no live call) and proves the loop mechanics + the dev-set discriminator that makes iterative
feedback teach PROVENANCE:

  1. the dev estate carries the benign legit-twin (tag-presence FALSE-ALARMS, provenance spares it);
  2. TEST feedback names the false alarm and shows its authoritative source (memberOf) — the signal to fix;
  3. a grammar-broken rule comes back as a fixable "did not evaluate" message, not a crash;
  4. draft(TEST)->refine(SUBMIT) returns the submitted rule; never-submit hits the cap and returns the last
     cleanly-scored rule; a spiralled (empty) turn is non-fatal and the loop recovers; prose-only errors out;
  5. HELD-OUT ISOLATION: the module never imports the grounded corpus loaders, so the loop cannot peek at
     the scoring set.

Pure stdlib; run: python3 selftest_correlation_agent.py
"""

import json
import os
import sys
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))
sys.path.insert(0, str(_SKILL / "tasks" / "detect_F2easy_federation"))

import correlation_agent_provider as agent  # noqa: E402

TAG_RULE = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "emitted_tags", "op": "contains",
     "value": {"$config": "honored_tag"}}]}
PROV_RULE = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "emitted_tags", "op": "contains",
     "value": {"$config": "honored_tag"}},
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "overlaps",
     "value": {"$config": "self_service_attrs"}}]}
BAD_RULE = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "overlaps",
     "value": "not-a-list"}]}  # overlaps needs a list -> CorrelationUnsupported


def _fence(rule):
    return "```json\n" + json.dumps(rule) + "\n```"


def check(name, cond):
    print(("  ok  " if cond else " FAIL ") + name)
    if not cond:
        raise SystemExit(1)


def test_discriminator():
    events, truth, config = agent._dev_instance("0")
    n_benign = sum(v == "benign" for v in truth.values())
    check("dev estate has the legit-twin (6 benign incl. B7)", n_benign == 6)
    tag = agent._score_dev(TAG_RULE, events, truth, config)
    prov = agent._score_dev(PROV_RULE, events, truth, config)
    check("tag-presence FALSE-ALARMS on the twin (fp=1)", tag["fp"] == 1 and tag["recall"] == 1.0)
    check("provenance spares the twin (fp=0, recall 1.0)", prov["fp"] == 0 and prov["recall"] == 1.0)


def test_feedback_teaches_provenance():
    events, truth, config = agent._dev_instance("0")
    fb = agent._feedback(TAG_RULE, events, truth, config)
    check("feedback flags the FALSE ALARM", "FALSE ALARM" in fb)
    check("feedback exposes the authoritative source (memberOf)", "memberOf" in fb)
    check("feedback reports the precision miss", "precision" in fb and "false alarm" in fb.lower())
    perfect = agent._feedback(PROV_RULE, events, truth, config)
    check("provenance rule gets a PERFECT/ SUBMIT prompt", "PERFECT" in perfect and "SUBMIT" in perfect)


def test_grammar_error_is_fixable():
    events, truth, config = agent._dev_instance("0")
    fb = agent._feedback(BAD_RULE, events, truth, config)
    check("bad grammar -> fixable 'did not evaluate' message", fb.startswith("Your rule did not evaluate"))


def test_extract_rule():
    r, t = agent._extract_rule("here is my rule\n" + _fence(PROV_RULE))
    check("extract from fenced block", r == PROV_RULE)
    r2, _ = agent._extract_rule("SUBMIT\n" + json.dumps(TAG_RULE))  # bare JSON, no fence
    check("extract bare JSON", r2 == TAG_RULE)
    r3, _ = agent._extract_rule("I am still thinking about the approach.")
    check("prose -> no rule", r3 is None)


class _MockChat:
    """Feeds scripted turns to the loop in place of a live model call."""
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = 0

    def __call__(self, *a, **k):
        self.calls += 1
        return self.turns.pop(0) if self.turns else ("", "length", None)  # exhausted -> spiral


def _run(turns, max_turns=5):
    os.environ["_AGENT_SELFTEST_KEY"] = "x"
    opts = {"config": {"base_url": "http://mock", "api_key_env": "_AGENT_SELFTEST_KEY",
                       "max_turns": max_turns}}
    saved = agent._chat
    agent._chat = _MockChat(turns)
    try:
        return agent.call_api(options=opts)
    finally:
        agent._chat = saved


def test_draft_then_submit():
    res = _run([
        ("TEST\n" + _fence(TAG_RULE), "stop", None),      # draft: tag-presence (false alarms)
        ("SUBMIT\n" + _fence(PROV_RULE), "stop", None),   # refine + submit: provenance
    ])
    check("draft->submit returns output", "output" in res)
    check("submitted flag set", res.get("metadata", {}).get("submitted") is True)
    check("submitted rule is the provenance rule", json.loads(agent._extract_rule(res["output"])[1]) == PROV_RULE)


def test_never_submit_hits_cap():
    res = _run([
        ("TEST\n" + _fence(TAG_RULE), "stop", None),
        ("TEST\n" + _fence(PROV_RULE), "stop", None),
        ("TEST\n" + _fence(TAG_RULE), "stop", None),
    ], max_turns=3)
    check("cap reached -> still returns output", "output" in res)
    check("cap output not submitted", res.get("metadata", {}).get("submitted") is False)
    check("cap output is the last cleanly-scored rule (tag rule from t3)",
          json.loads(agent._extract_rule(res["output"])[1]) == TAG_RULE)


def test_spiral_is_non_fatal():
    res = _run([
        ("", "length", None),                              # t1: spiral (empty) -> nudge
        ("TEST\n" + _fence(TAG_RULE), "stop", None),       # t2: recovers
        ("SUBMIT\n" + _fence(PROV_RULE), "stop", None),    # t3: submit
    ])
    check("spiral recovered and submitted", res.get("metadata", {}).get("submitted") is True)
    check("spiral trace recorded", any("empty" in s for s in res.get("metadata", {}).get("trace", [])))


def test_prose_only_errors():
    res = _run([("just thinking, no rule", "stop", None)] * 3, max_turns=3)
    check("prose-only -> error (no usable rule)", "error" in res and "no usable rule" in res["error"])


def test_held_out_isolation():
    # scan the CODE, not the module docstring (which documents, in prose, the loaders it avoids).
    import re
    src = (Path(agent.__file__)).read_text()
    src = re.sub(r'""".*?"""', "", src, count=1, flags=re.DOTALL)  # drop the leading module docstring
    check("no import of verify_correlation", "import verify_correlation" not in src
          and "from verify_correlation" not in src)
    # the held-out loaders live only in verify_correlation; with no import of it they cannot be CALLED.
    for banned in ("_scoring_corpus(", "_grounded_estate(", "_live_instances(", "verify("):
        check(f"no call to held-out loader {banned}", banned not in src)
    check("grounded corpus loader not in sys.modules via this provider",
          "verify_correlation" not in sys.modules)


if __name__ == "__main__":
    # isolation check must run before anything imports verify_correlation transitively.
    test_held_out_isolation()
    test_discriminator()
    test_feedback_teaches_provenance()
    test_grammar_error_is_fixable()
    test_extract_rule()
    test_draft_then_submit()
    test_never_submit_hits_cap()
    test_spiral_is_non_fatal()
    test_prose_only_errors()
    print("\nall agentic-provider selftests passed")
