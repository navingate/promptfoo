#!/usr/bin/env python3
"""Generate ../references/task-catalog.md from catalog.manifest.json.

The manifest is the single source of truth (per the security review: counts and
coverage must come from one machine-readable manifest so prose can't drift). Edit
the manifest, then run this. Deterministic (no timestamps) so regeneration is a
no-op when nothing changed.

    python3 gen_catalog.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "catalog.manifest.json"
OUT = HERE.parent / "references" / "task-catalog.md"
CELL_ORDER = ["R", "E", "M", "C", "I", "P", "X", "D", "S"]


def _built(task_id: str) -> bool:
    return (HERE / task_id).is_dir()


def _cells(item: dict) -> str:
    return ", ".join(item.get("cells", []))


def main() -> None:
    m = json.loads(MANIFEST.read_text())
    atomic = m["atomic"]
    scenarios = m["scenarios"]
    capstone = m["capstone"]
    diagnostics = [a for a in atomic if a["disposition"] != "move_l2"]
    moved = [a for a in atomic if a["disposition"] == "move_l2"]

    L: list[str] = []
    L.append("# Enterprise cyber-capability task catalog")
    L.append("")
    L.append(
        f"<!-- GENERATED from tasks/catalog.manifest.json by gen_catalog.py — do not edit by hand. canary: {m['canary']} -->"
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
        "- **Tier 1 — atomic diagnostics:** single-capability tasks for debugging, "
        "calibration, and as ingredients of Tier-2 scenarios. Not headline assurance "
        "results on their own."
    )
    L.append(
        "- **Tier 2 — staged scenarios:** multi-step chains across a real enterprise "
        "trust boundary — the deployment-gate signal. An atomic task that is an "
        "*ingredient* of a scenario is not counted twice."
    )
    L.append("")
    L.append(
        "Legend — **Exec:** text_reasoning / sandbox_tools / browser / multi_system · **SUT** (system under test): fixed_scaffold_model / client_agent / both · **Sens:** low/med/high · **Build:** S/M/L · **Disp:** see `catalog.manifest.json` dispositions."
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
            feeds = a.get("feeds", "—")
            L.append(
                f"| {a['id']} | {a['title']} | {_cells(a)} | {a['exec_mode']} | {a['sut']} | "
                f"{a['sensitivity']} | {a['build']} | {a['disposition']} | {feeds} | "
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
        "| id | Scenario | Cells | Ingredients | Enterprise signal | Deterministic success | Sens | Build |"
    )
    L.append(
        "| -- | -------- | ----- | ----------- | ----------------- | --------------------- | ---- | ----- |"
    )
    for s in scenarios:
        ing = ", ".join(s.get("ingredients", [])) or "—"
        L.append(
            f"| {s['id']} | {s['title']} | {_cells(s)} | {ing} | {s['signal']} | "
            f"{s['success']} | {s['sensitivity']} | {s['build']} |"
        )
    L.append("")

    # --- capstone ---
    L.append("## Capstone")
    L.append("")
    for c in capstone:
        L.append(
            f"- **{c['id']} {c['title']}** ({_cells(c)}) — ingredients {', '.join(c['ingredients'])}. "
            f"{c['signal']} Integration result, not additional taxonomy breadth."
        )
    L.append("")

    # --- counts + coverage ---
    L.append("## Counts & coverage")
    L.append("")
    L.append(
        f"- **{len(diagnostics)} atomic diagnostics** + **{len(scenarios)} staged scenarios** "
        f"+ **{len(capstone)} capstone**. ({len(moved)} candidates reclassified to L2.)"
    )
    L.append("")
    # per-cell catalogued (atomic diagnostics + scenarios + capstone), and built
    catalogued = {c: 0 for c in CELL_ORDER}
    built = {c: 0 for c in CELL_ORDER}
    for item in diagnostics + scenarios + capstone:
        for c in item.get("cells", []):
            if c in catalogued:
                catalogued[c] += 1
    for a in diagnostics:
        if _built(a["id"]):
            for c in a.get("cells", []):
                built[c] += 1
    L.append(
        "Coverage is reported by stage, not as one number (per the review). Today: **catalogued** only — 0 built/validated/executed/demonstrated (the sole built sandbox is the `_smoke` plumbing task, which is not a security scenario)."
    )
    L.append("")
    L.append("| Cell | Meaning | Catalogued | Built |")
    L.append("| ---- | ------- | ---------: | ----: |")
    for c in CELL_ORDER:
        L.append(f"| {c} | {m['cells'][c]} | {catalogued[c]} | {built[c]} |")
    L.append("")
    L.append(
        "> After the honest relabel, the atomic tier concentrates on **I** and **X**; "
        "**R** and **E** are genuinely thin in the authored set (external recon and true "
        "exploit-development are not what these tasks measure); **M/C/D/S** live mostly in "
        "the gated sensitive tier. This is corrected coverage, not aspiration."
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
        "All sensitive/gated tasks build only behind the Phase 3 isolation gate with mock/"
        "inert components, synthetic data, no egress, and explicit human sign-off. See "
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
