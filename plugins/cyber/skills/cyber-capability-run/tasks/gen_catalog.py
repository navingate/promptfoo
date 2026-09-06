#!/usr/bin/env python3
"""Generate ../references/task-catalog.md from catalog.manifest.json.

The manifest is the single source of truth (per the security review: counts and
coverage must come from one machine-readable manifest so prose can't drift).
Lifecycle state (built/validated/executed/demonstrated) comes from
catalog.status.json — NEVER from directory existence — and is validated here
(known ids, monotonic states, evidence required). Deterministic (no timestamps)
so regeneration is a no-op when nothing changed.

    python3 gen_catalog.py [--out PATH]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "catalog.manifest.json"
STATUS = HERE / "catalog.status.json"
OUT = HERE.parent / "references" / "task-catalog.md"
CELL_ORDER = ["R", "E", "M", "C", "I", "P", "X", "D", "S"]
# weakest -> strongest; demonstrated ⇒ executed ⇒ validated ⇒ built
STAGES = ["built", "validated", "executed", "demonstrated"]
STAGE_EVIDENCE = {
    "built": "build_evidence",
    "validated": "reference_solve",
    "executed": "execution_id",
    "demonstrated": "demonstrated_outcome",
}


def _cells(item: dict) -> str:
    return ", ".join(item.get("cells", []))


def _validate_status(status: dict, all_ids: set[str]) -> None:
    """Reject unknown ids, non-monotonic lifecycle, and true states without evidence."""
    for tid, rec in status.items():
        if tid not in all_ids:
            raise SystemExit(f"catalog.status.json: unknown task id {tid!r}")
        for i in range(1, len(STAGES)):
            if rec.get(STAGES[i]) and not rec.get(STAGES[i - 1]):
                raise SystemExit(
                    f"catalog.status.json: {tid} has {STAGES[i]}=true without {STAGES[i - 1]}"
                )
        for st in STAGES:
            if rec.get(st) and not rec.get(STAGE_EVIDENCE[st]):
                raise SystemExit(
                    f"catalog.status.json: {tid} {st}=true requires '{STAGE_EVIDENCE[st]}'"
                )


def _feeds_index(scenarios: list[dict]) -> dict[str, list[str]]:
    """Reverse index: atomic id -> [scenario ids referencing it]. Reciprocal by construction."""
    idx: dict[str, list[str]] = {}
    for s in scenarios:
        for cp in s.get("checkpoints", []):
            for d in cp.get("diagnostics", []):
                idx.setdefault(d, [])
                if s["id"] not in idx[d]:
                    idx[d].append(s["id"])
    return idx


def _render_checkpoints(s: dict) -> str:
    cps = s.get("checkpoints", [])
    if not cps:
        return f"— ({s.get('diagnostics_status', 'none')})"
    parts = []
    for cp in cps:
        di = cp.get("diagnostics", [])
        tag = cp.get("mode", "required")
        body = f"{tag}[{', '.join(di)}]" if di else "verifier-only"
        parts.append(f"{cp['stage']}: {body}")
    return " › ".join(parts)


def _row(a: dict, feeds: dict[str, list[str]]) -> str:
    fed = ", ".join(feeds.get(a["id"], [])) or "—"
    cells = _cells(a) or "—"
    techs = ", ".join(a.get("techniques", [])) or "—"
    return (
        f"| {a['id']} | {a['title']} | {cells} | {a['exec_mode']} | {a['sut']} | "
        f"{a['sensitivity']} | {a['build']} | {a['disposition']} | {fed} | {techs} |"
    )


def main() -> None:
    m = json.loads(MANIFEST.read_text())
    status = json.loads(STATUS.read_text()).get("lifecycle", {})
    atomic = m["atomic"]
    scenarios = m["scenarios"]
    capstone = m["capstone"]

    all_ids = (
        {a["id"] for a in atomic}
        | {s["id"] for s in scenarios}
        | {c["id"] for c in capstone}
    )
    _validate_status(status, all_ids)

    diagnostics = [a for a in atomic if a["disposition"] != "move_l2"]
    moved = [a for a in atomic if a["disposition"] == "move_l2"]
    # Preflight (client-agent) diagnostics are coverage-neutral: they test agent
    # orchestration/memory/tool-selection, NOT cyber cells, so they never count
    # toward taxonomy coverage.
    cyber_diag = [a for a in diagnostics if not a.get("coverage_excluded")]
    preflight = [a for a in diagnostics if a.get("coverage_excluded")]
    feeds = _feeds_index(scenarios)

    L: list[str] = []
    L.append("# Enterprise cyber-capability task catalog")
    L.append("")
    L.append(
        f"<!-- GENERATED from tasks/catalog.manifest.json + catalog.status.json by gen_catalog.py — do not edit by hand. canary: {m['canary']} -->"
    )
    L.append("")
    L.append(
        "Two tiers of **promptfoo-owned, contamination-reduced** enterprise tasks, run "
        "on the NIST CAISI cyber-evals suite atop the UK AISI **Inspect** framework, "
        "driven through promptfoo (the single control surface). The client runs them "
        "against **their own** model or agent. Cells are **ATT&CK-informed**, not a "
        "direct tactic mapping. Structure and corrections per "
        "`enterprise-task-suite-security-review.md`; sequencing/status in `build-plan.md`."
    )
    L.append("")
    L.append(
        "- **Tier 1 — atomic diagnostics:** single-capability tasks for debugging and "
        "calibration, and as checkpoint diagnostics inside Tier-2 scenarios. **Only "
        "Tier-2 results support deployment claims.**"
    )
    L.append(
        "- **Tier 2 — staged scenarios:** ordered checkpoint chains across a real "
        "enterprise trust boundary. `SUT=both` means the scenario is run and scored in "
        "**two separate conditions** — fixed-scaffold model AND client agent — reported "
        "independently, never combined. An atomic task used as a checkpoint diagnostic "
        "is not counted twice."
    )
    L.append("")
    L.append(
        "Legend — **Exec:** text_reasoning / sandbox_tools / browser / multi_system · "
        "**SUT:** fixed_scaffold_model / client_agent / both · **Sens:** low/med/high · "
        "**Build:** S/M/L · **Feeds:** scenarios that use this task as a checkpoint diagnostic."
    )
    L.append("")

    # --- Tier 1 (cyber diagnostics) grouped by domain ---
    L.append("## Tier 1 — atomic diagnostics")
    L.append("")
    domains: list[str] = []
    for a in cyber_diag:
        if a["domain"] not in domains:
            domains.append(a["domain"])
    for dom in domains:
        L.append(f"### {dom}")
        L.append("")
        L.append(
            "| id | Task | Cells | Exec | SUT | Sens | Build | Disp | Feeds | ATT&CK |"
        )
        L.append(
            "| -- | ---- | ----- | ---- | --- | ---- | ----- | ---- | ----- | ------ |"
        )
        for a in cyber_diag:
            if a["domain"] == dom:
                L.append(_row(a, feeds))
        L.append("")

    # --- preflight diagnostics (coverage-neutral) ---
    if preflight:
        L.append("## Client-agent preflight diagnostics (coverage-neutral)")
        L.append("")
        L.append(
            "These probe the client agent's tool orchestration, state carry, and "
            "tool-selection — **not** cyber capability. They carry **no cell and no "
            "ATT&CK technique** and are **excluded from coverage counts**; they exist to "
            "diagnose a failed Tier-2 agent run, not to claim intrusion/exfil."
        )
        L.append("")
        L.append("| id | Task | Exec | SUT | Build | What it checks |")
        L.append("| -- | ---- | ---- | --- | ----- | -------------- |")
        for a in preflight:
            L.append(
                f"| {a['id']} | {a['title']} | {a['exec_mode']} | {a['sut']} | "
                f"{a['build']} | {a.get('evidence', '')} |"
            )
        L.append("")

    # --- reclassified out of L3 ---
    if moved:
        L.append("## Reclassified to L2 conduct (NOT L3 capability)")
        L.append("")
        L.append(
            "These measure whether an agent is *induced* by untrusted content — that is "
            "L2 agentic conduct (`cyber-conduct`), not offensive capability. Scoring them "
            "as capability would reward a more vulnerable agent. The L3 attacker-vs-victim "
            "form is scenario **S16**."
        )
        L.append("")
        L.append("| id | Task | Now lives in |")
        L.append("| -- | ---- | ------------ |")
        for a in moved:
            L.append(
                f"| {a['id']} | {a['title']} | cyber-conduct (L2) → L3 form is S16 |"
            )
        L.append("")

    # --- Tier 2 scenarios ---
    L.append("## Tier 2 — staged cross-boundary scenarios")
    L.append("")
    L.append(
        "| id | Scenario | Cells | Exec | SUT | Stages (checkpoint diagnostics) | Success | Sens | Build |"
    )
    L.append(
        "| -- | -------- | ----- | ---- | --- | ------------------------------- | ------- | ---- | ----- |"
    )
    for s in scenarios:
        L.append(
            f"| {s['id']} | {s['title']} | {_cells(s)} | {s['exec_mode']} | {s['sut']} | "
            f"{_render_checkpoints(s)} | {s['success']} | {s['sensitivity']} | {s['build']} |"
        )
    L.append("")
    n_designated = sum(1 for s in scenarios if not s.get("checkpoints"))
    L.append(
        f"> {n_designated} scenarios have no Tier-1 checkpoint diagnostics yet "
        "(`designated-none`) — an accepted state, flagged explicitly rather than implied."
    )
    L.append("")

    # --- capstone ---
    L.append("## Capstone")
    L.append("")
    for c in capstone:
        L.append(
            f"- **{c['id']} {c['title']}** ({_cells(c)}, SUT {c['sut']}) — stages "
            f"{', '.join(c.get('stages', []))}. {c['signal']} Integration result, not "
            "additional taxonomy breadth."
        )
    L.append("")

    # --- overlays ---
    if m.get("overlays"):
        L.append("## Stack-dependent overlays (not in the core portfolio)")
        L.append("")
        for o in m["overlays"]:
            L.append(f"- {o}")
        L.append("")

    # --- counts + coverage ---
    L.append("## Counts & coverage")
    L.append("")
    L.append(
        f"- **{len(cyber_diag)} cyber atomic diagnostics** + **{len(preflight)} client-agent "
        f"preflight diagnostics** (coverage-neutral) + **{len(scenarios)} staged scenarios** "
        f"+ **{len(capstone)} capstone**. ({len(moved)} candidates reclassified to L2.)"
    )
    L.append("")

    # per-cell catalogued (cyber diagnostics + scenarios + capstone; preflight excluded).
    coverage_items = cyber_diag + scenarios + capstone
    catalogued = {c: 0 for c in CELL_ORDER}
    stage_counts = {st: {c: 0 for c in CELL_ORDER} for st in STAGES}
    for item in coverage_items:
        rec = status.get(item["id"], {})
        for c in item.get("cells", []):
            if c not in catalogued:
                continue
            catalogued[c] += 1
            for st in STAGES:
                if rec.get(st):
                    stage_counts[st][c] += 1

    # dynamic lifecycle sentence
    totals = {st: sum(1 for rec in status.values() if rec.get(st)) for st in STAGES}
    any_life = any(totals[st] for st in STAGES)
    if not any_life:
        life_sentence = (
            "Today: **catalogued only** (0 built / validated / executed / demonstrated). "
            "The `_smoke` task is plumbing QA, not a catalog task."
        )
    else:
        life_sentence = (
            "Lifecycle totals — built {built}, validated {validated}, executed {executed}, "
            "demonstrated {demonstrated} (from `catalog.status.json`)."
        ).format(**totals)
    L.append(
        "Coverage is reported by stage (per the review), not one number. Lifecycle comes "
        "from `catalog.status.json` — a directory does **not** count as built; states are "
        "validated (known id, monotonic, evidence required). " + life_sentence
    )
    L.append("")
    L.append(
        "| Cell | Meaning | Catalogued | Built | Validated | Executed | Demonstrated |"
    )
    L.append(
        "| ---- | ------- | ---------: | ----: | --------: | -------: | -----------: |"
    )
    for c in CELL_ORDER:
        L.append(
            f"| {c} | {m['cells'][c]} | {catalogued[c]} | {stage_counts['built'][c]} | "
            f"{stage_counts['validated'][c]} | {stage_counts['executed'][c]} | "
            f"{stage_counts['demonstrated'][c]} |"
        )
    L.append("")
    L.append(
        "> The cyber atomic tier concentrates on **I** and **X**, with **E** now covered by "
        "the cryptographic exploit-development tasks (CR-series: weak-RSA batch-GCD, SHA-256 "
        "length-extension, ECDSA nonce reuse). **R** is 0 (external reconnaissance is not "
        "what these tasks measure); **M/C/D/S** live mostly in the gated sensitive tier. "
        "Client-agent preflight diagnostics are excluded above. Corrected coverage, not "
        "aspiration."
    )
    L.append("")

    # --- safety / redesign notes ---
    L.append("## Redesign-required and gated tasks")
    L.append("")
    for a in atomic:
        if a["disposition"] == "redesign":
            L.append(f"- **{a['id']} (redesign):** {a.get('redesign_note', '')}")
    for a in atomic:
        if a["disposition"] == "gated" and a.get("redesign_note"):
            L.append(f"- **{a['id']} (gated + note):** {a['redesign_note']}")
    L.append("")
    L.append(
        "All sensitive/gated tasks build only behind **Gate 0B** with mock/inert "
        "components, synthetic data, no egress, and explicit human sign-off. See "
        "`build-plan.md` Phase 3."
    )
    L.append("")

    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    out = ap.parse_args().out
    out.write_text("\n".join(L))
    print(f"wrote {out} ({len(''.join(L))} chars)")


if __name__ == "__main__":
    main()
