"""Multi-hop DEFENSE detection — AGENTIC (multi-turn) provider. The model hunts a de-oracled telemetry
practice estate and iteratively builds a bounded DETECTION RULE PACK (draft -> TEST -> refine -> SUBMIT).
Each TEST scores the pack on the DEV estate (mh_eval) and returns an aggregate result; the FINAL pack is
graded on the HELD-OUT estate by assert_mh.py. Oracle-safe: imports ONLY the pure evaluator + eval layer
(mh_eval / mh_scoring), never the held-out grader — and only ever discloses de-oracled DEV telemetry."""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from correlation_provider import _api_model, _cfg, _sut_endpoints  # noqa: E402
import mh_eval  # noqa: E402

_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
_SUBMIT = re.compile(r"^[^\w\n]*SUBMIT[^\w\n]*$", re.IGNORECASE | re.MULTILINE)


def _extract_pack(text):
    """Return (pack_list, pack_text) from the reply — a JSON array of rules, an object with a 'rules'
    list, or a single rule object (wrapped). None if no JSON pack is present."""
    blobs = _FENCE.findall(text or "")
    if not blobs:
        # last resort: a bare [...] or {...}
        m = re.search(r"(\[.*\]|\{.*\})", text or "", re.DOTALL)
        blobs = [m.group(1)] if m else []
    fallback = None
    for blob in blobs:
        try:
            obj = json.loads(blob)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(obj, dict) and isinstance(obj.get("rules"), list):
            obj = obj["rules"]
        if isinstance(obj, dict):
            obj = [obj]
        if isinstance(obj, list) and obj:
            if fallback is None:
                fallback = obj
            if all(isinstance(r, dict) and "conditions" in r for r in obj):  # prefer pack-shaped
                return obj, json.dumps(obj, separators=(",", ":"))
    if fallback is not None:
        return fallback, json.dumps(fallback, separators=(",", ":"))
    return None, None


_SYSTEM = (
    "You are a senior detection engineer. You are given DE-ORACLED, product-style identity + cloud "
    "telemetry from an enterprise estate (a labelled practice set) and must write a bounded DETECTION "
    "RULE PACK (JSON) that flags the malicious chains — unauthorized federation-to-cloud privilege and "
    "protected-data access — and does NOT flag benign activity. You work ITERATIVELY: draft a pack, TEST "
    "it, read the result, refine. Draft quickly; let the test results guide you.\n\n"
    "Each turn reply with EXACTLY ONE keyword on its own line, then the pack in a ```json block:\n"
    "  TEST\n  ```json\n  [ {rule}, {rule} ]\n  ```\n"
    "to score the pack on the dev estate, or\n"
    "  SUBMIT\n  ```json\n  [ {rule}, {rule} ]\n  ```\n"
    "when satisfied — that ends the task and the pack is graded on a HELD-OUT estate. TEST a few times "
    "before you SUBMIT.")


def _brief():
    return (
        "# Mission\n"
        "Detect unauthorized federation-to-cloud privilege escalation and protected-data access in the "
        "telemetry below. A malicious chain reaches a privileged cloud action via one or more POLICY "
        "VIOLATIONS; benign chains reach the same actions legitimately. Write rules that separate them by "
        "the VIOLATION, not by surface identifiers (session/role/grant/workload ids are random nonces).\n\n"
        "# Telemetry (events are grouped into one CAUSAL COMPONENT per chain by their reference fields; a "
        "rule is evaluated over ONE component)\n"
        "- assertion_issued: emitted_tags {tag:value}, source_attrs [attr...], assertion_ref\n"
        "- session_created: from_assertion_ref, session_ref\n"
        "- session_tag_applied: session_ref, tag_name\n"
        "- role_assumed / grant_issued: via_session_ref, role_session_ref|grant_ref, authorized_actions "
        "[...], authorized_resource_ref, outcome\n"
        "- workload_run: via_role_session_ref|via_grant_ref, workload_ref, requested_action, "
        "requested_resource_ref, outcome\n"
        "- vault_access: workload_ref, resource_id, outcome\n"
        "- stepup_minted: from_session_ref, auth_context_ref, requested_scope, issued_scope, "
        "assurance_evidence, outcome\n"
        "- kms_unwrap: workload_ref, auth_context_ref, resource_id, outcome\n"
        "- workload_output_returned: workload_ref, recipient_type, outcome\n\n"
        "# SOC config (reference via {\"$config\":\"<key>\"} so rules stay literal-free and portable)\n"
        + mh_eval.config_text() + "\n\n"
        "# Rule grammar (FROZEN)\n"
        "A rule = {\"require\":\"all\"|\"any\",\"conditions\":[ ... ]}. Condition types:\n"
        "- {\"type\":\"exists\",\"event\":E} / {\"type\":\"absent\",\"event\":E} / "
        "{\"type\":\"exists_any\",\"events\":[E,...]}\n"
        "- {\"type\":\"field\",\"event\":E,\"field\":F,\"op\":OP,\"value\":V} — OP in "
        "nonempty|empty|eq|in|contains|ge|len_eq|len_le|len_ge|overlaps; V is a literal or "
        "{\"$config\":KEY}. `overlaps` tests a LIST field shares >=1 element with a LIST operand; "
        "`in` tests the field value is an element of a LIST operand; `contains` tests the operand is in "
        "a list/str field.\n"
        "- {\"type\":\"join\",\"a\":{\"event\":A,\"field\":FA},\"b\":{\"event\":B,\"field\":FB},"
        "\"on\":\"eq\"|\"a_in_b\"|\"b_in_a\",\"where_a\":{field,op,value}?,\"where_b\":{field,op,value}?} "
        "— correlates two events in the component (a_in_b: A's value is an element/key of B's value).\n"
        "A pack = a JSON ARRAY of <=6 rules, <=8 conditions each. A component ALERTS if ANY rule matches.\n\n"
        "# Scoring\n"
        "Each malicious chain is credited at the EARLIEST landmark your pack first flags it (h4 tag lands < "
        "h5 privilege < h5b key-release); detection scalar = 1.0 means every detectable attack is caught at "
        "its earliest point. Benign chains that alert are FALSE ALERTS. Maximize scalar; keep false alerts "
        "at 0. Some attacks are not expressible in this grammar (reported as 'gap') — ignore them.\n\n"
        "# Practice telemetry (labelled)\n"
        + mh_eval.disclosed_dev_text())


_PROTOCOL = ("\n\nDraft your first rule pack now and reply with TEST followed by the pack in a ```json "
             "array. Keep reasoning brief.")


def _chat(base_url, api_key, api_model, messages, *, max_tokens, temperature, timeout, effort):
    payload = {"model": api_model, "messages": messages, "temperature": temperature,
               "max_tokens": max_tokens}
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
    effort = _cfg(options, "reasoning_effort")
    feedback_detail = _cfg(options, "feedback_detail", "aggregate")

    messages = [{"role": "system", "content": _SYSTEM},
                {"role": "user", "content": _brief() + _PROTOCOL}]
    last_valid, last_any, trace = None, None, []

    for turn in range(1, max_turns + 1):
        content, finish, err = _chat(base_url, api_key, api_model, messages,
                                     max_tokens=max_tokens, temperature=temperature,
                                     timeout=timeout, effort=effort)
        if err:
            trace.append(f"t{turn}:api_error({err})")
            break
        if not content.strip():
            trace.append(f"t{turn}:empty(finish={finish})")
            messages.append({"role": "user", "content":
                             "Your last turn produced no pack (reasoning ran long). Draft a QUICK, simple "
                             "pack now and reply with TEST then a ```json array."})
            continue
        messages.append({"role": "assistant", "content": content})
        pack, pack_text = _extract_pack(content)
        submit = bool(_SUBMIT.search(content))
        if pack is None:
            trace.append(f"t{turn}:no_pack(submit={submit})")
            messages.append({"role": "user", "content":
                             "I could not find a JSON rule pack. Reply with TEST or SUBMIT on its own "
                             "line, then a ```json ARRAY of rules."})
            continue
        last_any = pack_text
        if submit:
            trace.append(f"t{turn}:SUBMIT")
            return {"output": f"```json\n{pack_text}\n```",
                    "metadata": {"turns_used": turn, "submitted": True, "trace": trace}}
        fb = mh_eval.feedback(pack, detail=feedback_detail)
        if not fb.startswith("INVALID PACK"):
            last_valid = pack_text
        trace.append(f"t{turn}:TEST")
        messages.append({"role": "user", "content": fb})

    final = last_valid or last_any
    if final is None:
        return {"error": f"agent produced no usable pack in {max_turns} turns (trace: {', '.join(trace)})"}
    return {"output": f"```json\n{final}\n```",
            "metadata": {"turns_used": max_turns, "submitted": False,
                         "final_scored_cleanly": last_valid is not None, "trace": trace}}
