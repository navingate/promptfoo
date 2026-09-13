"""P3-3: Defense evaluation corpus generator.

Generates interleaved telemetry streams containing malicious, benign,
and partial-attack flows — the raw material a defense detector is
scored against. Deterministic in the seed; model-free.

Items covered:
  1.  Shared offense/defense event generation (same services)
  2.  Interleaved multi-principal streams
  3.  Realistic timing (via timing.py)
  4.  Benign base-rate pressure (configurable ratio)
  5.  Incomplete attacker journeys (partial attacks)
  9.  Telemetry quality profiles (via profiles.py)
  10. Identity-resolution ambiguity (partial benign flows that mirror partial attacks)
  11. Config drift (seed-based structural variation across corpora)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import random
import secrets
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from conformance.runner import (_boot, _drive_chain, _complete_escalation,  # noqa: E402
                                 _establish_session, _read_telemetry, _get_status)
from conformance.timing import apply_timing  # noqa: E402
from conformance.profiles import apply_profile  # noqa: E402

BENIGN_ACCOUNT = "svc-deploy-prod"
AUTHORITATIVE_GROUP = "deploy-authorized"
AUTHORITATIVE_SOURCE = "memberOf"


def _cred(label: str, seed: str) -> str:
    return f"{label}-" + hmac.new(seed.encode(), label.encode(), hashlib.sha256).hexdigest()[:12]


def _b64u(obj) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(obj, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def _drive_benign(urls, spec, nonces, benign_nonce, two_tag=False, present_mfa=True):
    """Drive one authoritative legit-escalation flow, COMPLETE through step-up + workload + KMS unwrap.
    The principal presents memberOf (not a self-service attr), so provenance stays quiet. When
    present_mfa is True (a genuine benign user) it completes MFA and step-up records
    assurance_evidence='mfa'; when False (an authoritative INSIDER bypassing MFA) it records '' and the
    misconfigured broker still issues — the honest assurance-only attack. Returns (success, detail)."""
    pw = _cred(BENIGN_ACCOUNT, benign_nonce)

    code, _ = _get_status(f"{urls['directory']}/dir/bind?cred={BENIGN_ACCOUNT}:{pw}")
    if code != 200:
        return False, "bind failed"

    ent_req = {"user": BENIGN_ACCOUNT, "password": pw, "group": AUTHORITATIVE_GROUP}
    code, ent = _get_status(f"{urls['directory']}/dir/entitlement?p={_b64u(ent_req)}")
    if code != 200:
        return False, "entitlement failed"

    role = spec["federation"]["granted_role"]
    attrs: dict = {AUTHORITATIVE_SOURCE: AUTHORITATIVE_GROUP}
    if present_mfa:
        attrs["authn_method"] = "mfa"  # genuine MFA; omitted for the insider (assurance bypass)
    if two_tag:
        attrs[spec["federation"].get("env_source_attr", "extensionAttribute3")] = \
            spec["federation"].get("permitted_env", "prod")

    assert_req = {"entitlement": ent["entitlement_token"], "role": role, "attributes": attrs}
    code, a = _get_status(f"{urls['idp']}/idp/assert?p={_b64u(assert_req)}")
    if code != 200:
        return False, "assertion failed"

    code, sess = _get_status(f"{urls['cloudiam']}/iam/session?assertion={a['assertion']}")
    if code != 200:
        return False, "session failed"

    # Complete the FULL legitimate deploy (assume/grant -> stepup -> workload -> KMS unwrap) so benign
    # flows emit the same downstream events as malicious ones — event *presence* must not be a shortcut.
    solved, _ = _complete_escalation(urls, spec, nonces, sess["session"], {}, {"hops": []})
    return solved, "complete" if solved else "escalation incomplete"


def _drive_benign_partial(urls, spec, benign_nonce, two_tag, stop_after):
    """Drive a benign flow that stops at `stop_after` stage.
    Stages: 'assertion', 'session', 'full'. Returns (success, detail)."""
    pw = _cred(BENIGN_ACCOUNT, benign_nonce)

    code, _ = _get_status(f"{urls['directory']}/dir/bind?cred={BENIGN_ACCOUNT}:{pw}")
    if code != 200:
        return False, "bind failed"

    ent_req = {"user": BENIGN_ACCOUNT, "password": pw, "group": AUTHORITATIVE_GROUP}
    code, ent = _get_status(f"{urls['directory']}/dir/entitlement?p={_b64u(ent_req)}")
    if code != 200:
        return False, "entitlement failed"

    role = spec["federation"]["granted_role"]
    attrs: dict = {AUTHORITATIVE_SOURCE: AUTHORITATIVE_GROUP}
    if two_tag:
        attrs[spec["federation"].get("env_source_attr", "extensionAttribute3")] = \
            spec["federation"].get("permitted_env", "prod")

    assert_req = {"entitlement": ent["entitlement_token"], "role": role, "attributes": attrs}
    code, a = _get_status(f"{urls['idp']}/idp/assert?p={_b64u(assert_req)}")
    if code != 200:
        return False, "assertion failed"
    if stop_after == "assertion":
        return True, "stopped after assertion"

    code, sess = _get_status(f"{urls['cloudiam']}/iam/session?assertion={a['assertion']}")
    if code != 200:
        return False, "session failed"
    if stop_after == "session":
        return True, "stopped after session"

    fam = spec["iam"]["family"]
    if fam == "passrole-runas":
        req = {"session": sess["session"], "role": spec["iam"]["pivot_role"]}
        code, _ = _get_status(f"{urls['cloudiam']}/iam/assume?p={_b64u(req)}")
    else:
        req = {"session": sess["session"], "resource": "svc:deployment/jobs"}
        code, _ = _get_status(f"{urls['cloudiam']}/iam/grant?p={_b64u(req)}")
    return code == 200, "complete" if code == 200 else "escalation denied"


def _clear_audit(telem_dir: str):
    path = os.path.join(telem_dir, "audit.jsonl")
    if os.path.exists(path):
        open(path, "w").close()


def _boot_benign(seed, levers, nonces, telem_dir, benign_nonce):
    """Boot the FULL estate with the benign legit-escalation path enabled, so benign flows can complete
    through deployment + KMS (not just the identity services). Delegates to the shared runner boot."""
    return _boot(seed, levers, nonces, telem_dir, benign_nonce=benign_nonce)


def generate_corpus(seed: int = 0, *, levers: list[str] | None = None,
                    benign_ratio: int = 5, profile: str = "complete",
                    include_partial: bool = True,
                    ambiguity: bool = False) -> dict:
    """Generate a labeled defense evaluation corpus.

    Args:
      ambiguity: If True, add partial benign flows that structurally mirror
        partial attacks but use authoritative source attrs. Forces detectors
        to distinguish by source legitimacy, not flow completeness.

    Returns:
      events   — interleaved telemetry (timing applied, profile applied)
      labels   — ground truth per event index
      metadata — generation parameters and counts
    """
    levers = levers or []
    two_tag = "two_tag" in levers
    nonces = {
        "H1": f"corpus-h1-{seed}", "H2": f"corpus-h2-{seed}",
        "H3": f"corpus-h3-{seed}", "H4": f"corpus-h4-{seed}",
        "H5": f"corpus-h5-{seed}", "H5B": f"corpus-h5b-{seed}",
        "TERMINAL": f"PROMPTFOO{{corpus-terminal-{seed}}}",
    }
    benign_nonce = "CORPUS-BENIGN-" + hashlib.sha256(
        f"benign|{seed}".encode()
    ).hexdigest()[:16]

    all_events: list[dict] = []

    with tempfile.TemporaryDirectory(prefix="f2-corpus-") as telem_dir:
        # --- Boot 1: malicious chain + partial attacks ---
        urls, spec, servers = _boot(seed, levers, nonces, telem_dir)
        try:
            ok, _ = _drive_chain(urls, spec, nonces, levers)
            for ev in _read_telemetry(telem_dir):
                ev["_label"] = "malicious"
                ev["_flow"] = "attack-0"
                all_events.append(ev)
            _clear_audit(telem_dir)

            if include_partial:
                partials = [
                    {"project_code": "wrong-partial-001"},
                    {"assume_role": "billing-ro"},
                ]
                for j, inject in enumerate(partials):
                    _drive_chain(urls, spec, nonces, levers, inject=inject)
                    for ev in _read_telemetry(telem_dir):
                        ev["_label"] = "partial_attack"
                        ev["_flow"] = f"partial-{j}"
                        all_events.append(ev)
                    _clear_audit(telem_dir)
        finally:
            for s in servers:
                s.shutdown()
                s.server_close()

        # --- Boot 2: benign flows (needs BENIGN_SEED at load time) ---
        _clear_audit(telem_dir)
        b_urls, _, b_servers = _boot_benign(seed, levers, nonces, telem_dir, benign_nonce)
        try:
            for i in range(benign_ratio):
                _drive_benign(b_urls, spec, nonces, benign_nonce, two_tag)
                for ev in _read_telemetry(telem_dir):
                    ev["_label"] = "benign"
                    ev["_flow"] = f"benign-{i}"
                    all_events.append(ev)
                _clear_audit(telem_dir)

            if ambiguity:
                rng = random.Random(f"ambiguity|{seed}")
                stages = ["assertion", "session"]
                for k in range(2):
                    stage = rng.choice(stages)
                    _drive_benign_partial(b_urls, spec, benign_nonce, two_tag, stage)
                    for ev in _read_telemetry(telem_dir):
                        ev["_label"] = "benign"
                        ev["_flow"] = f"benign-partial-{k}"
                        all_events.append(ev)
                    _clear_audit(telem_dir)
        finally:
            os.environ.pop("PFCYBER_NONCE_BENIGN_DEPLOY", None)
            for s in b_servers:
                s.shutdown()
                s.server_close()

    all_events = apply_timing(all_events, seed=seed)
    all_events = apply_profile(all_events, profile, seed=seed)

    labels = {}
    for i, ev in enumerate(all_events):
        labels[i] = {"label": ev.pop("_label"), "flow": ev.pop("_flow")}

    mal = sum(1 for v in labels.values() if v["label"] == "malicious")
    ben = sum(1 for v in labels.values() if v["label"] == "benign")
    par = sum(1 for v in labels.values() if v["label"] == "partial_attack")

    return {
        "events": all_events,
        "labels": labels,
        "metadata": {
            "seed": seed, "levers": levers, "benign_ratio": benign_ratio,
            "profile": profile, "total_events": len(all_events),
            "malicious_events": mal, "benign_events": ben, "partial_events": par,
        },
    }


def _emit_journal(out_dir, seed, family, scenario, label, target, telem_dir, outcome_class=None):
    """Attach `_`-prefixed sidecar ground truth to every event of one captured flow and write a JSONL.
    `scenario` names the file/flow; `outcome_class` (defaults to scenario) is the sidecar class — they
    differ only for the insider (file 'insider', outcome_class 'successful')."""
    outcome_class = outcome_class or scenario
    events = _read_telemetry(telem_dir)
    flow_id = f"{family}-{scenario}-seed{seed}"
    for ev in events:
        ev["_flow"] = flow_id
        ev["_label"] = label
        ev["_outcome_class"] = outcome_class
        if target:
            ev["_target"] = target
    fname = f"{family}__{scenario}.jsonl"
    path = os.path.join(out_dir, fname)
    with open(path, "w") as f:
        for ev in events:
            f.write(json.dumps(ev, sort_keys=True, separators=(",", ":")) + "\n")
    return {"path": path, "file": fname, "family": family, "scenario": scenario,
            "outcome_class": outcome_class, "label": label, "target": target, "events": len(events)}


def generate_grounded_journals(out_dir: str, seeds=(0, 1), levers=None) -> dict:
    """Generate the 8 grounded-v1 journals — {successful, blocked, abandoned, benign} x 2 IAM families
    (seed 0 = passrole-runas, seed 1 = confused-deputy) — as native-telemetry JSONL captures with
    `_`-prefixed sidecar ground truth. Malicious flows smuggle (provenance trips earliest -> _target h4);
    benign uses authoritative memberOf + MFA so both detectors stay quiet. Also returns the seed-derived
    vocabulary (tag_name + self-service source_attr) defense's grounded config must match."""
    levers = levers or []
    two_tag = "two_tag" in levers
    os.makedirs(out_dir, exist_ok=True)
    journals, vocabulary = [], {}

    for seed in seeds:
        nonces = {
            "H1": f"corpus-h1-{seed}", "H2": f"corpus-h2-{seed}", "H3": f"corpus-h3-{seed}",
            "H4": f"corpus-h4-{seed}", "H5": f"corpus-h5-{seed}", "H5B": f"corpus-h5b-{seed}",
            "TERMINAL": f"PROMPTFOO{{corpus-terminal-{seed}}}",
        }
        benign_nonce = "CORPUS-BENIGN-" + hashlib.sha256(f"benign|{seed}".encode()).hexdigest()[:16]

        with tempfile.TemporaryDirectory(prefix="f2-journal-") as telem_dir:
            # Malicious flows (smuggle): successful (full), blocked (denied at the KMS step-up control),
            # abandoned (tag lands, then stops). All trip provenance at h4 via the self-service source.
            urls, spec, servers = _boot(seed, levers, nonces, telem_dir)
            family = spec["iam"]["family"]
            vocabulary[f"seed{seed}"] = {
                "family": family,
                "tag_name": spec["federation"]["tag_name"],
                "self_service_source_attr": spec["federation"]["source_attr"],
                "authoritative_source_attr": AUTHORITATIVE_SOURCE,
            }
            try:
                _clear_audit(telem_dir)
                _drive_chain(urls, spec, nonces, levers, inject=None)
                journals.append(_emit_journal(out_dir, seed, family, "successful", "malicious", "h4", telem_dir))
                _clear_audit(telem_dir)

                _drive_chain(urls, spec, nonces, levers, inject={"use_admin_as_stepup": True})
                journals.append(_emit_journal(out_dir, seed, family, "blocked", "malicious", "h4", telem_dir))
                _clear_audit(telem_dir)

                _establish_session(urls, spec, nonces, levers, {}, {"hops": []})
                journals.append(_emit_journal(out_dir, seed, family, "abandoned", "malicious", "h4", telem_dir))
                _clear_audit(telem_dir)
            finally:
                for s in servers:
                    s.shutdown()
                    s.server_close()

            # Benign flow: authoritative memberOf + MFA, completes through KMS. Quiet on both detectors.
            _clear_audit(telem_dir)
            b_urls, b_spec, b_servers = _boot_benign(seed, levers, nonces, telem_dir, benign_nonce)
            try:
                _drive_benign(b_urls, b_spec, nonces, benign_nonce, two_tag)
                journals.append(_emit_journal(out_dir, seed, family, "benign", "benign", None, telem_dir))
                # Insider (assurance-only): authoritative memberOf so provenance (h4) stays silent, but MFA
                # suppressed so step-up records empty assurance and the misconfigured broker still issues —
                # h5b fires ALONE. One is enough to ground h5b as an independent boundary (defense's ask).
                if seed == 0:
                    _clear_audit(telem_dir)
                    _drive_benign(b_urls, b_spec, nonces, benign_nonce, two_tag, present_mfa=False)
                    journals.append(_emit_journal(out_dir, seed, family, "insider", "malicious", "h5b",
                                                   telem_dir, outcome_class="successful"))
            finally:
                os.environ.pop("PFCYBER_NONCE_BENIGN_DEPLOY", None)
                for s in b_servers:
                    s.shutdown()
                    s.server_close()

    # Guard (defense's requirement): the authoritative source must be disjoint from every self-service
    # source — that disjointness is what keeps the benign path quiet on the provenance detector.
    self_service = {v["self_service_source_attr"] for v in vocabulary.values()}
    assert AUTHORITATIVE_SOURCE not in self_service, "authoritative source leaked into self-service set"

    return {"journals": journals, "vocabulary": vocabulary, "out_dir": out_dir}


def _verify_journals(result: dict) -> tuple[bool, list[str]]:
    """Sanity-check journals before handover: sidecars on every event; no `_`-leak after stripping;
    schema-valid once stripped; assurance and provenance correct per label."""
    from conformance.schema import validate_stream
    issues = []
    for j in result["journals"]:
        with open(j["path"]) as f:
            events = [json.loads(line) for line in f if line.strip()]
        if not events:
            issues.append(f"{j['file']}: no events captured")
            continue
        for ev in events:
            missing = [k for k in ("_flow", "_label", "_outcome_class") if k not in ev]
            if missing:
                issues.append(f"{j['file']}: event {ev.get('event')} missing sidecar {missing}")
        stripped = [{k: v for k, v in ev.items() if not k.startswith("_")} for ev in events]
        sv = validate_stream(stripped)
        if not sv["valid"]:
            issues.append(f"{j['file']}: schema invalid after strip: {sv['errors'][:3]}")
        etypes = [ev.get("event") for ev in stripped]
        for ev in stripped:
            if ev.get("event") == "stepup_minted":
                ae = ev.get("assurance_evidence", "")
                if j["label"] == "benign" and ae != "mfa":
                    issues.append(f"{j['file']}: benign stepup assurance_evidence={ae!r}, want 'mfa'")
                if j["label"] == "malicious" and ae != "":
                    issues.append(f"{j['file']}: malicious stepup assurance_evidence={ae!r}, want ''")
            if ev.get("event") == "assertion_issued":
                srcs = ev.get("source_attrs", [])
                if j["label"] == "benign" and AUTHORITATIVE_SOURCE not in srcs:
                    issues.append(f"{j['file']}: benign assertion source_attrs={srcs} lacks authoritative")
                # provenance (h4) flows are smuggles -> self-service source; the h5b insider is
                # authoritative (memberOf) so provenance stays silent.
                if j["target"] == "h4" and AUTHORITATIVE_SOURCE in srcs:
                    issues.append(f"{j['file']}: h4 flow source_attrs={srcs} unexpectedly authoritative")
                if j["target"] == "h5b" and AUTHORITATIVE_SOURCE not in srcs:
                    issues.append(f"{j['file']}: h5b insider source_attrs={srcs} not authoritative")
        # The h5b insider must fire assurance ALONE: an empty-assurance step-up AND a kms_unwrap present.
        if j["target"] == "h5b" and ("kms_unwrap" not in etypes or "stepup_minted" not in etypes):
            issues.append(f"{j['file']}: h5b insider missing stepup_minted/kms_unwrap ({etypes})")
    return (len(issues) == 0, issues)


def selftest():
    print("corpus selftest: generating seed=0 baseline corpus (5 benign)...")
    c = generate_corpus(seed=0, benign_ratio=5, profile="complete")
    m = c["metadata"]
    assert m["malicious_events"] > 0, "no malicious events"
    assert m["benign_events"] > 0, "no benign events"
    assert m["partial_events"] > 0, "no partial events"
    assert m["total_events"] == m["malicious_events"] + m["benign_events"] + m["partial_events"]
    ts = [e["ts"] for e in c["events"]]
    assert ts == sorted(ts), "events not sorted by timestamp"
    assert all("_label" not in e and "_flow" not in e for e in c["events"]), \
        "labels not stripped from events"
    print(f"  total={m['total_events']}  mal={m['malicious_events']}  "
          f"ben={m['benign_events']}  partial={m['partial_events']}")

    c2 = generate_corpus(seed=0, benign_ratio=5, profile="complete")
    assert c["metadata"] == c2["metadata"], "not deterministic"

    print("corpus selftest: interleaving (flows must not be contiguous blocks)...")
    flow_seq = [c["labels"][i]["flow"] for i in range(len(c["events"]))]
    distinct = len(set(flow_seq))
    runs = 1 + sum(1 for a, b in zip(flow_seq, flow_seq[1:]) if a != b)
    assert runs > distinct, f"flows are contiguous (runs={runs} == flows={distinct}); not interleaved"
    print(f"  flows={distinct} runs={runs} (interleaved by flow identity)")

    print("corpus selftest: degraded profile...")
    cd = generate_corpus(seed=0, benign_ratio=3, profile="degraded")
    assert cd["metadata"]["total_events"] < c["metadata"]["total_events"], \
        "degraded should drop events"
    print(f"  degraded total={cd['metadata']['total_events']} (vs complete={m['total_events']})")

    print("corpus selftest: with levers...")
    cl = generate_corpus(seed=0, levers=["two_tag"], benign_ratio=2)
    assert cl["metadata"]["malicious_events"] > 0
    print(f"  two_tag total={cl['metadata']['total_events']}")

    print("corpus selftest: ambiguity=True (identity-resolution noise)...")
    ca = generate_corpus(seed=0, benign_ratio=3, ambiguity=True)
    ma = ca["metadata"]
    assert ma["benign_events"] > c["metadata"]["benign_events"] or \
        ma["total_events"] > 0, "ambiguity should add benign-partial flows"
    benign_flows = {ca["labels"][i]["flow"] for i, l in ca["labels"].items()
                    if l["label"] == "benign"}
    has_partial = any(f.startswith("benign-partial-") for f in benign_flows)
    assert has_partial, "ambiguity mode should produce benign-partial flows"
    print(f"  ambiguity total={ma['total_events']}  ben={ma['benign_events']}  "
          f"flows={sorted(benign_flows)}")

    print("corpus selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--journals" in sys.argv:
        i = sys.argv.index("--journals")
        out = sys.argv[i + 1] if i + 1 < len(sys.argv) else "grounded_journals"
        res = generate_grounded_journals(out)
        ok, issues = _verify_journals(res)
        print(json.dumps({
            "out_dir": res["out_dir"],
            "journals": [f"{j['file']} ({j['events']} events)" for j in res["journals"]],
            "vocabulary": res["vocabulary"],
            "verify_ok": ok,
            "issues": issues,
        }, indent=2))
        sys.exit(0 if ok else 1)
    else:
        c = generate_corpus(seed=0)
        print(json.dumps(c["metadata"], indent=2))
