#!/usr/bin/env python3
"""Generate ../references/task-catalog.md from catalog.manifest.json.

The manifest is the single source of truth (per the security review: counts and
coverage must come from one machine-readable manifest so prose can't drift).
Lifecycle state (built/validated/executed/demonstrated) comes from
catalog.status.json — NEVER from directory existence. Deterministic (no
timestamps) so regeneration is a no-op when nothing changed.

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
STAGES = ["built", "validated", "executed", "demonstrated"]


def _cells(item: dict) -> str:
    return ", ".join(item.get("cells", []))


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


def main() -> None:
    m = json.loads(MANIFEST.read_text())
    status = json.loads(STATUS.read_text()).get("lifecycle", {})
    atomic = m["atomic"]
    scenarios = m["scenarios"]
    capstone = m["capstone"]
    diagnostics = [a for a in atomic if a["disposition"] != "move_l2"]
    moved = [a for a in atomic if a["disposition"] == "move_l2"]
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

    # --- Tier 1 grouped by domain ---
    L.append("## Tier 1 — atomic diagnostics")
    L.append("")
    domains: list[str] = []
    for a in diagnostics:
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
        for a in diagnostics:
            if a["domain"] != dom:
                continue
            fed = ", ".join(feeds.get(a["id"], [])) or "—"
            L.append(
                f"| {a['id']} | {a['title']} | {_cells(a)} | {a['exec_mode']} | {a['sut']} | "
                f"{a['sensitivity']} | {a['build']} | {a['disposition']} | {fed} | "
                f"{', '.join(a.get('techniques', []))} |"
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
        f"- **{len(diagnostics)} atomic diagnostics** + **{len(scenarios)} staged scenarios** "
        f"+ **{len(capstone)} capstone**. ({len(moved)} candidates reclassified to L2.)"
    )
    L.append("")

    # per-cell catalogued (diagnostics + scenarios + capstone); lifecycle from status record.
    catalogued = {c: 0 for c in CELL_ORDER}
    stage_counts = {st: {c: 0 for c in CELL_ORDER} for st in STAGES}
    for item in diagnostics + scenarios + capstone:
        rec = status.get(item["id"], {})
        for c in item.get("cells", []):
            if c not in catalogued:
                continue
            catalogued[c] += 1
            for st in STAGES:
                if rec.get(st):
                    stage_counts[st][c] += 1
    L.append(
        "Coverage is reported by stage (per the review), not one number. Lifecycle comes "
        "from `catalog.status.json` — a directory does **not** count as built. Today: "
        "**catalogued only** (0 built/validated/executed/demonstrated). The `_smoke` task "
        "is plumbing QA, not a catalog task."
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
        "> After the honest relabel, the atomic tier concentrates on **I** and **X**; "
        "**R** and **E** are 0 in the authored set (external recon and true "
        "exploit-development are not what these tasks measure); **M/C/D/S** live mostly in "
        "the gated sensitive tier. Corrected coverage, not aspiration."
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
