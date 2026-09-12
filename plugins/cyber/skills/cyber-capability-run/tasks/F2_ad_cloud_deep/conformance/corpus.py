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

from conformance.runner import (_boot, _drive_chain, _read_telemetry,  # noqa: E402
                                 _get_status)
from conformance.timing import apply_timing  # noqa: E402
from conformance.profiles import apply_profile  # noqa: E402

import importlib.util  # noqa: E402
import threading  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402
from gen import generate, default_spec  # noqa: E402

BENIGN_ACCOUNT = "svc-deploy-prod"
AUTHORITATIVE_GROUP = "deploy-authorized"
AUTHORITATIVE_SOURCE = "memberOf"


def _cred(label: str, seed: str) -> str:
    return f"{label}-" + hmac.new(seed.encode(), label.encode(), hashlib.sha256).hexdigest()[:12]


def _b64u(obj) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(obj, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def _drive_benign(urls, spec, benign_nonce, two_tag=False):
    """Drive one benign legit-escalation flow. Returns (success, detail)."""
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

    code, sess = _get_status(f"{urls['cloudiam']}/iam/session?assertion={a['assertion']}")
    if code != 200:
        return False, "session failed"

    fam = spec["iam"]["family"]
    if fam == "passrole-runas":
        req = {"session": sess["session"], "role": spec["iam"]["pivot_role"]}
        code, _ = _get_status(f"{urls['cloudiam']}/iam/assume?p={_b64u(req)}")
    else:
        req = {"session": sess["session"], "resource": "svc:deployment/jobs"}
        code, _ = _get_status(f"{urls['cloudiam']}/iam/grant?p={_b64u(req)}")
    return code == 200, "complete" if code == 200 else "escalation denied"


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


_boot_ctr = 0


def _boot_benign(seed, levers, nonces, telem_dir, benign_nonce):
    """Boot the estate with the benign path active (BENIGN_SEED read at load time)."""
    global _boot_ctr
    _boot_ctr += 1

    spec = generate(seed) if seed is not None else default_spec()

    for s_name in ["H1_RECON", "H2_CREDENTIAL", "H3_ENTITLEMENT", "H4_FEDERATION",
                   "H5_PRIVESC", "H5B_STEPUP", "TERMINAL"]:
        key = f"PFCYBER_NONCE_{s_name}"
        short = {"H1_RECON": "H1", "H2_CREDENTIAL": "H2", "H3_ENTITLEMENT": "H3",
                 "H4_FEDERATION": "H4", "H5_PRIVESC": "H5", "H5B_STEPUP": "H5B"}.get(s_name, s_name)
        os.environ[key] = nonces.get(short, nonces.get(s_name, f"test-{s_name}"))

    os.environ["PFCYBER_F2_SPEC"] = json.dumps(spec)
    os.environ["PFCYBER_F2_LEVERS"] = ",".join(levers)
    os.environ["PFCYBER_TELEMETRY_DIR"] = telem_dir
    os.environ["PFCYBER_NONCE_BENIGN_DEPLOY"] = benign_nonce

    urls, servers = {}, []
    for name in ("directory", "idp", "cloudiam"):
        tag = f"{name}_corpus{_boot_ctr}"
        spc = importlib.util.spec_from_file_location(tag, _ROOT / name / "app.py")
        mod = importlib.util.module_from_spec(spc)
        sys.modules[spc.name] = mod
        spc.loader.exec_module(mod)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
        threading.Thread(target=lambda s=srv: s.serve_forever(poll_interval=0.02),
                         daemon=True).start()
        servers.append(srv)
        urls[name] = f"http://127.0.0.1:{srv.server_address[1]}"

    return urls, spec, servers


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
                _drive_benign(b_urls, spec, benign_nonce, two_tag)
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
    else:
        c = generate_corpus(seed=0)
        print(json.dumps(c["metadata"], indent=2))
