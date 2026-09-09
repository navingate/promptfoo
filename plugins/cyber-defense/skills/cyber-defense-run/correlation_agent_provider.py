#!/usr/bin/env python3
"""Promptfoo AGENTIC provider for the F2 federation CORRELATION defense task — the multi-turn twin of the
single-shot correlation_provider.py.

WHY THIS EXISTS. Reasoning models (GLM-5.2/5.3) with thinking ON cannot solve the correlation task in one
shot: their chain-of-thought fills any max_tokens budget and the API returns finish_reason=length with EMPTY
content (measured: GLM-5.3 3/3 honest single-shot runs spiralled). The ONE framing that made thinking-on
converge was telling the model it would get to REFINE against test results — a promise that is a lie in
single-shot but TRUE here. So this provider runs a bounded draft -> TEST -> refine -> SUBMIT loop (the same
shape as the offense agentic solver: bounded per-turn reasoning, converging each turn on concrete feedback).

DEV / HELD-OUT SPLIT (oracle-safe, by construction):
  * The loop's TEST feedback scores the candidate rule ONLY on a DISCLOSED, SYNTHETIC dev estate generated
    fresh IN MEMORY (corpus_gen.generate(seed, with_legit_twin=True)) with the task's soc_config.json. That
    generator emits salted pseudonyms and NO markers/nonces, so nothing sensitive is disclosed; the dev
    estate carries a benign legit-twin so TEST punishes a mere tag-presence rule and teaches PROVENANCE.
  * The model's FINAL rule (this provider's output) is scored by the UNCHANGED held-out path
    (assert_correlation.py -> verify() over grounded/ + grounded_seed9/), exactly like the single-shot
    provider. This module imports ONLY the pure evaluator (correlation_eval); it never imports or calls the
    held-out corpus loaders (_scoring_corpus / _grounded_estate / _live_instances / verify), so there is no
    code path from the model's loop to the held-out set.

Same per-model interface as the offense/single-shot side (CYBER_SUT_ENDPOINT + CYBER_MODEL, with the
CYBER_<KEY> env fallback). Extra knobs: CYBER_MAX_TURNS (default 5), CYBER_HTTP_TIMEOUT (per-turn seconds,
default 300). The WHOLE loop runs inside one call_api, so promptfoo's python-worker timeout must cover every
turn: set REQUEST_TIMEOUT_MS high (e.g. 1800000). Run one model per command, e.g.:
  CYBER_SUT_ENDPOINT=engy CYBER_MODEL=openai/glm-5.3 REQUEST_TIMEOUT_MS=1800000 \
    npm run local -- eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.correlation_agent.yaml \
      --no-cache --repeat 10 --max-concurrency 2 -o /tmp/f2def_agent_glm53.json

Referenced as: providers: - id: file://correlation_agent_provider.py
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
if str(_SKILL) not in sys.path:
    sys.path.insert(0, str(_SKILL))
_TASK = _SKILL / "tasks" / "detect_F2easy_federation"
if str(_TASK) not in sys.path:
    sys.path.insert(0, str(_TASK))

# endpoint resolution is shared with the single-shot provider (which itself reuses the offense registry).
from correlation_provider import _api_model, _cfg, _sut_endpoints  # noqa: E402

# ONLY the pure evaluator — no held-out corpus loader is importable from here (see module docstring).
from correlation_eval import CorrelationUnsupported, build_incidents, flagged_incidents  # noqa: E402

_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
# a SUBMIT/TEST keyword as a standalone token (not inside a larger word), case-insensitive.
_SUBMIT = re.compile(r"(?<![A-Za-z])SUBMIT(?![A-Za-z])", re.IGNORECASE)
_TEST = re.compile(r"(?<![A-Za-z])TEST(?![A-Za-z])", re.IGNORECASE)


def _extract_rule(text: str):
    """Pull the JSON rule from a turn: the first ```json fenced block, else the first {...} span. Returns
    (rule_dict, rule_text) or (None, None) if nothing parses. Mirrors assert_correlation._extract so the
    dev-set TEST and the held-out grade read the model's rule identically."""
    m = _FENCE.search(text or "")
    candidate = m.group(1).strip() if m else None
    if candidate is None:  # no fence — try the first balanced-looking {...} span
        s, e = (text or "").find("{"), (text or "").rfind("}")
        candidate = text[s:e + 1] if 0 <= s < e else None
    if not candidate:
        return None, None
    try:
        rule = json.loads(candidate)
        return (rule, candidate) if isinstance(rule, dict) else (None, None)
    except Exception:  # noqa: BLE001 - unparseable this turn; caller asks the model to fix it
        return None, None


def _dev_instance(seed: str):
    """The disclosed synthetic dev estate the TEST step scores on: (events, truth, config). Generated fresh
    in memory with the benign legit-twin ON, plus the task's real soc_config.json (honored_tag +
    self_service pool) so {"$config": ...} references resolve exactly as in the held-out grade."""
    import corpus_gen
    events, truth = corpus_gen.generate(seed, with_legit_twin=True)
    config = json.loads((_TASK / "soc_config.json").read_text())
    return events, truth, config


def _incident_summary(events: list[dict]) -> str:
    """One-line-per-event digest of a dev incident, showing only the fields that DISCRIMINATE (source_attrs,
    which tag was emitted/applied, outcome, whether privesc succeeded) — never the salted pseudonym values."""
    parts = []
    for e in sorted(events, key=lambda ev: ev.get("seq", 0)):
        ev = e.get("event")
        if ev == "assertion_issued":
            tags = list((e.get("emitted_tags") or {}).keys())
            parts.append(f"assertion_issued(source_attrs={e.get('source_attrs')}, "
                         f"emitted_tags={tags or 'none'}, outcome={e.get('outcome')})")
        elif ev == "session_tag_applied":
            parts.append(f"session_tag_applied(tag_name={e.get('tag_name')})")
        elif ev in ("role_assumed", "grant_issued"):
            parts.append(f"{ev}(outcome={e.get('outcome')})  <- privilege escalation")
        elif ev == "claim_rules_read":
            parts.append("claim_rules_read")
        else:
            parts.append(f"{ev}(outcome={e.get('outcome')})")
    return "; ".join(parts)


def _score_dev(rule: dict, events, truth, config):
    """Confusion counts + the wrong incidents, computed inline (identical logic to verify_correlation.
    score_corpus) so this module needs no held-out import. Returns a dict, or raises CorrelationUnsupported
    if the rule's grammar is unsupported (surfaced to the model as a fixable error)."""
    flagged = flagged_incidents(rule, events, config)
    incidents = build_incidents(events)
    universe = set(incidents) | set(truth)
    tp = fp = fn = tn = 0
    missed, false_alarms = [], []
    for key in universe:
        malicious = truth.get(key) == "malicious"
        fired = key in flagged
        if fired and malicious:
            tp += 1
        elif fired and not malicious:
            fp += 1
            false_alarms.append(key)
        elif not fired and malicious:
            fn += 1
            missed.append(key)
        else:
            tn += 1
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    precision = tp / (tp + fp) if (tp + fp) else (1.0 if tp == 0 else 0.0)
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "recall": recall, "precision": precision,
            "missed": missed, "false_alarms": false_alarms, "incidents": incidents}


def _feedback(rule: dict, events, truth, config) -> str:
    """Render the TEST result as concrete, actionable feedback (aggregate score + each wrong incident with
    its discriminating fields). This is what bounds the model's reasoning: it drafts rough, sees exactly
    which incidents it got wrong and why, and refines."""
    try:
        s = _score_dev(rule, events, truth, config)
    except CorrelationUnsupported as exc:
        return (f"Your rule did not evaluate: {exc}. Fix the grammar (check the brief's rule spec — field "
                "ops, join structure, and that list ops get a list value) and TEST again.")
    n_mal = s["tp"] + s["fn"]
    lines = [f"TEST result on the dev estate: recall {s['recall']:.2f} "
             f"({s['tp']}/{n_mal} attacks caught), precision {s['precision']:.2f} "
             f"({s['fp']} false alarm(s) on benign activity)."]
    if s["fn"] == 0 and s["fp"] == 0:
        lines.append("PERFECT on the dev estate. If you are confident the rule generalises, SUBMIT it.")
        return "\n".join(lines)
    for key in s["missed"]:
        lines.append(f"MISSED attack [{key}] — your rule failed to flag this real attack: "
                     f"{_incident_summary(s['incidents'].get(key, []))}")
    for key in s["false_alarms"]:
        lines.append(f"FALSE ALARM [{key}] — this is BENIGN and your rule must NOT flag it: "
                     f"{_incident_summary(s['incidents'].get(key, []))}")
    lines.append("Refine the rule so it flags every attack and none of the benign activity, then TEST or "
                 "SUBMIT. Reply with ONLY the keyword then a ```json rule.")
    return "\n".join(lines)


_SYSTEM = (
    "You are a detection engineer building a CROSS-EVENT correlation rule (JSON, in the grammar the brief "
    "specifies) that flags the described federation claim-smuggling attacks WITHOUT flagging benign "
    "federation activity. You work ITERATIVELY over a few turns: draft a rule, test it, read the result, "
    "and refine. Do NOT over-deliberate on any single turn — draft quickly and let the test results guide "
    "you.\n\n"
    "Each turn reply with EXACTLY ONE keyword on its own line, then the rule in a ```json code block:\n"
    "  TEST\n  ```json\n  { ...rule... }\n  ```\n"
    "to score the rule on a dev estate (you'll get recall/precision and which incidents you got wrong), or\n"
    "  SUBMIT\n  ```json\n  { ...rule... }\n  ```\n"
    "when you are satisfied — that ends the task and the rule is graded on a held-out estate. TEST a few "
    "times before you SUBMIT.")

_PROTOCOL = (
    "\n\nYou are now in the iterative loop. Draft your first correlation rule and reply with TEST followed "
    "by the rule in a ```json block. Keep your reasoning brief.")


def _chat(base_url, api_key, api_model, messages, *, max_tokens, temperature, timeout, effort):
    """One OpenAI-compatible chat turn. Returns (content, finish_reason, error). Reasoning models put their
    chain-of-thought in a separate field and only then emit `content`; if the budget is exhausted
    mid-reasoning the API returns finish_reason=length with EMPTY content — reported so the loop can treat a
    spiralled turn as non-fatal (keep the last good rule) rather than crashing."""
    payload = {"model": api_model, "messages": messages,
               "temperature": temperature, "max_tokens": max_tokens}
    if effort:
        payload["reasoning_effort"] = effort
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        choice = data["choices"][0]
        content = (choice.get("message", {}) or {}).get("content") or ""
        return content, choice.get("finish_reason"), None
    except urllib.error.HTTPError as e:
        return "", None, f"{e.code} {e.reason}: {e.read()[:300].decode(errors='replace')}"
    except Exception as e:  # noqa: BLE001
        return "", None, f"{type(e).__name__}: {e}"


def call_api(prompt=None, options=None, context=None):
    from prompts.correlation_prompt import build_prompt

    endpoint = _cfg(options, "sut_endpoint", "chutes")
    model = _cfg(options, "model", "openai/DeepSeek-V4-Flash")
    base_url = _cfg(options, "base_url")
    api_key_env = _cfg(options, "api_key_env")
    if not base_url or not api_key_env:
        preset = _sut_endpoints().get(endpoint, {})
        base_url = base_url or preset.get("base_url")
        api_key_env = api_key_env or preset.get("api_key_env")
    if not base_url or not api_key_env:
        return {"error": f"endpoint {endpoint!r}: set CYBER_SUT_ENDPOINT or CYBER_BASE_URL + CYBER_API_KEY_ENV"}
    api_key = os.environ.get(api_key_env, "")
    if not api_key:
        return {"error": f"API key env {api_key_env!r} is empty for endpoint {endpoint!r}"}

    api_model = _api_model(model)
    max_turns = int(_cfg(options, "max_turns", 5))
    max_tokens = int(_cfg(options, "max_tokens", 16000))
    temperature = float(_cfg(options, "temperature", 0.7))
    timeout = int(_cfg(options, "http_timeout", 300))
    effort = _cfg(options, "reasoning_effort")  # default unset -> thinking ON
    dev_seed = str(_cfg(options, "dev_seed", "0"))

    events, truth, config = _dev_instance(dev_seed)

    # seed the conversation with the brief + SOC config (same build_prompt the single-shot task uses), then
    # switch the system message to the agent framing and append the protocol kickoff.
    base = build_prompt()
    brief = next((m["content"] for m in base if m["role"] == "user"), "")
    messages = [{"role": "system", "content": _SYSTEM},
                {"role": "user", "content": brief + _PROTOCOL}]

    last_valid_text = None   # most recent rule that PARSED and scored (no grammar error)
    last_any_text = None     # most recent rule that at least parsed as JSON (may be grammar-unsupported)
    trace = []
    for turn in range(1, max_turns + 1):
        content, finish, err = _chat(base_url, api_key, api_model, messages, max_tokens=max_tokens,
                                     temperature=temperature, timeout=timeout, effort=effort)
        if err:
            trace.append(f"t{turn}:api_error({err})")
            break  # endpoint/transport failure — stop; fall through to last good rule below
        if not content.strip():
            trace.append(f"t{turn}:empty(finish={finish})")
            # a spiralled turn (finish=length) is non-fatal: nudge once and keep going.
            messages.append({"role": "user", "content":
                             "Your last turn produced no rule (reasoning ran long). Draft a QUICK, simple "
                             "rule now and reply with TEST then a ```json block."})
            continue

        messages.append({"role": "assistant", "content": content})
        rule, rule_text = _extract_rule(content)
        submit = bool(_SUBMIT.search(content))
        if rule is None:
            trace.append(f"t{turn}:no_rule(submit={submit})")
            messages.append({"role": "user", "content":
                             "I could not find a JSON rule in your reply. Reply with the keyword TEST or "
                             "SUBMIT on its own line, then the rule in a ```json code block."})
            continue

        last_any_text = rule_text
        if submit:
            trace.append(f"t{turn}:SUBMIT")
            return {"output": f"```json\n{rule_text}\n```",
                    "metadata": {"turns_used": turn, "submitted": True, "trace": trace}}

        # TEST (default when a rule is present without SUBMIT): score on the dev estate, feed back.
        fb = _feedback(rule, events, truth, config)
        if not fb.startswith("Your rule did not evaluate"):
            last_valid_text = rule_text  # scored cleanly (grammar OK)
        trace.append(f"t{turn}:TEST")
        messages.append({"role": "user", "content": fb})

    # cap reached (or an early break) with no SUBMIT: grade the last rule the model produced — prefer one
    # that scored cleanly, else the last that at least parsed (held-out may mark it invalid), else error.
    final = last_valid_text or last_any_text
    if final is None:
        return {"error": f"agent produced no usable rule in {max_turns} turns (trace: {', '.join(trace)})"}
    return {"output": f"```json\n{final}\n```",
            "metadata": {"turns_used": max_turns, "submitted": False,
                         "final_scored_cleanly": last_valid_text is not None, "trace": trace}}
