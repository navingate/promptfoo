# f10-exfil-defense local G6 (run_id f10-exfil-defense-local-1) — reading note

Recorded 2026-10-11 at freeze `c7eb8cf43` on the 34.x box ($0 local floor; palmfuture Qwen3.6,
`--max-tokens 8000`). Tally: **16/30 pass, 14 model_failures** (parsed 30, exfil-recalled 29,
precision-clean 16).

**Report this as an OBSERVED local floor, with no causal claim.** The prior run (at `cd1e9eced`,
before the model-visible policy line) was 12/30. This run is 16/30, but that is a single run with no
control: do NOT attribute the +4 to the policy line. The dominant failure mode is **off-grammar label
tokens**, not a detection miss — the SUT emits `"cumulative_exfil"` (underscore) for a flow instead of
the expected answer code, so the runner scores it `model_fail` even when the flow it flagged is a true
exfil (several fails print `P=0 R=1` — recall held, precision/format broke). The 12→16 delta is within
format-adherence noise for this local model; it is not evidence the rule text improved detection.

The AUTHORIZATION_POLICY_LINE IS present in the recorded prompt (`…-prompt.txt`), confirming the model
saw the rule — that is the only thing this run establishes about the policy line. instance_ids are
list-identical to the prior run; `config.json` is byte-identical; only `prompt.txt` changed (the policy
line), the expected inversion vs a metadata-only hardening.

G6 stays PENDING (local floor only; the frontier ceiling is an owner hand-back). The failures being
off-grammar format — not wrong labels — means a cross-model/frontier run is the real separation signal.
