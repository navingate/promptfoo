#!/usr/bin/env python3
"""Stdlib selftest for the F2 correlation task's MODEL-FACING glue (prompt + assertion), without a live
model. Simulates model replies (the fixtures wrapped in a ```json block, plus prose-wrapped and malformed
outputs) and drives them through assert_correlation.get_assert exactly as promptfoo would; also checks the
prompt builder presents the threat brief. Proves the task is model-runnable end-to-end. Run:
`python3 selftest_correlation_glue.py`.
"""

import json
import sys
from pathlib import Path

from assert_correlation import get_assert
from prompts.correlation_prompt import build_prompt

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"


def reply(rule_json: str, prose: str = "") -> str:
    return f"{prose}\n```json\n{rule_json}\n```\n"


def main() -> int:
    # The assertion (verify_correlation.verify) scores against the GROUNDED real-attack corpus, assembled
    # from the committed bundles — no synthetic regeneration needed here.
    print("[selftest_correlation_glue]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    # prompt builder presents the threat brief as system+user messages
    msgs = build_prompt()
    check(isinstance(msgs, list) and msgs[0]["role"] == "system" and msgs[1]["role"] == "user",
          "build_prompt -> [system, user] messages")
    check("correlation rule" in msgs[1]["content"].lower() or "correlation" in json.dumps(msgs).lower(),
          "prompt presents the correlation threat brief")

    provenance = (TASK / "fixtures" / "correct_provenance.json").read_text()
    match_none = (TASK / "fixtures" / "match_none.json").read_text()

    # the v1.3 PROVENANCE reference rule in a fenced block -> pass at score 1.0, with recall/precision
    # surfaced. (It uses {"$config"} for both honored_tag and self_service_attrs; verify() threads
    # soc_config.json in, so this also exercises the config path end to end.)
    g = get_assert(reply(provenance, "Here is my correlation rule:"))
    check(g["pass_"] is True and g["score"] == 1.0,
          f"provenance rule (fenced, with prose) -> PASS score={g['score']:.2f} "
          f"[recall={g['named_scores'].get('recall')} precision={g['named_scores'].get('precision')}]")
    check(g["named_scores"].get("run_valid") == 1.0 and g["component_results"],
          "grading result carries run_valid + per-check component_results")

    # a rule that flags nothing -> security_failure, not a pass
    b = get_assert(reply(match_none))
    check(b["pass_"] is False and b["named_scores"].get("recall") == 0.0,
          f"match_none rule -> not pass ({b['reason'][:60]}...)")

    # a bare JSON rule with no code fence still extracts
    bare = get_assert(json.dumps(json.loads(provenance)))
    check(bare["pass_"] is True, "bare JSON (no fence) still parses + scores")

    # malformed output -> run_status invalid (surfaced, not a silent perf miss)
    inv = get_assert("I could not determine a rule.")
    check(inv["pass_"] is False and inv["named_scores"].get("run_valid") == 0.0,
          f"unparseable output -> run_status invalid (run_valid=0), pass=False")

    # the honored-tag PREVENTIVE rule also uses {"$config"} and fires preventively, but on the v1.3 twin
    # corpus it is now IMPRECISE (false-alarms on the benign legit-escalation twin) -> it does NOT pass, yet
    # the glue still threads soc_config.json and surfaces the timing diagnostic (pre_privesc_rate) end to end.
    # This proves the grade correctly FAILS an imprecise rule while still reporting its (ungated) timing.
    honored = (TASK / "fixtures" / "correct_preventive.json").read_text()
    p = get_assert(reply(honored, "Honored-tag rule:"))
    check(p["pass_"] is False and p["named_scores"].get("precision") < 1.0
          and p["named_scores"].get("pre_privesc_rate") is not None,
          f"honored-tag $config rule -> NOT pass (imprecise on the twin, precision "
          f"{p['named_scores'].get('precision')}) but timing diagnostic surfaced "
          f"(pre_privesc_rate={p['named_scores'].get('pre_privesc_rate')})")

    # the prompt exposes the SOC config so a model can actually write a config-driven rule
    up = build_prompt()[1]["content"]
    check("$config" in up and "honored_tag" in up,
          "prompt exposes SOC config ($config / honored_tag) for a preventive rule")

    # a rule referencing an UNKNOWN $config key is surfaced as invalid, not silently mis-scored
    badcfg = json.dumps({"require": "all", "conditions": [
        {"type": "field", "event": "session_tag_applied", "field": "tag_name", "op": "eq",
         "value": {"$config": "no_such_key"}}]})
    bc = get_assert(reply(badcfg))
    check(bc["pass_"] is False and bc["named_scores"].get("run_valid") == 0.0,
          "rule with unknown $config key -> run_status invalid (surfaced)")

    print("[selftest_correlation_glue]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
