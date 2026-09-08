#!/usr/bin/env python3
"""Stdlib selftest for the F2 correlation task's MODEL-FACING glue (prompt + assertion), without a live
model. Simulates model replies (the fixtures wrapped in a ```json block, plus prose-wrapped and malformed
outputs) and drives them through assert_correlation.get_assert exactly as promptfoo would; also checks the
prompt builder presents the threat brief. Proves the task is model-runnable end-to-end. Run:
`python3 selftest_correlation_glue.py`.
"""

import json
import subprocess
import sys
from pathlib import Path

from assert_correlation import get_assert
from prompts.correlation_prompt import build_prompt

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"


def reply(rule_json: str, prose: str = "") -> str:
    return f"{prose}\n```json\n{rule_json}\n```\n"


def main() -> int:
    print("[selftest_correlation_glue]")
    subprocess.run([sys.executable, str(TASK / "corpus_gen.py"), "0"], check=True, capture_output=True)
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

    correct = (TASK / "fixtures" / "correct.json").read_text()
    match_none = (TASK / "fixtures" / "match_none.json").read_text()

    # a good rule in a fenced block -> pass, with recall/precision surfaced
    g = get_assert(reply(correct, "Here is my correlation rule:"))
    check(g["pass_"] is True and g["score"] == 1.0,
          f"correct rule (fenced, with prose) -> PASS score={g['score']:.2f} "
          f"[recall={g['named_scores'].get('recall')} precision={g['named_scores'].get('precision')}]")
    check(g["named_scores"].get("run_valid") == 1.0 and g["component_results"],
          "grading result carries run_valid + per-check component_results")

    # a rule that flags nothing -> security_failure, not a pass
    b = get_assert(reply(match_none))
    check(b["pass_"] is False and b["named_scores"].get("recall") == 0.0,
          f"match_none rule -> not pass ({b['reason'][:60]}...)")

    # a bare JSON rule with no code fence still extracts
    bare = get_assert(json.dumps(json.loads(correct)))
    check(bare["pass_"] is True, "bare JSON (no fence) still parses + scores")

    # malformed output -> run_status invalid (surfaced, not a silent perf miss)
    inv = get_assert("I could not determine a rule.")
    check(inv["pass_"] is False and inv["named_scores"].get("run_valid") == 0.0,
          f"unparseable output -> run_status invalid (run_valid=0), pass=False")

    print("[selftest_correlation_glue]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
