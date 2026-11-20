# Cyber Score Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a private, automatically refreshing F2–F11 score dashboard whose numbers come from an append-only, evidence-linked registry in the fork.

**Architecture:** The fork holds a versioned JSON registry and a Python standard-library publisher. A separate buildless Site fetches that registry from GitHub, validates it, and renders a model-filtered ten-family matrix. The Site retains a dated fallback and visibly marks fetch failures as stale; new score commits appear without a Site redeploy.

**Tech Stack:** Python 3 standard library and `unittest`; static HTML/CSS/JavaScript with Node's built-in test runner; GitHub file API; Sites private hosting.

**Approved spec:** `docs/superpowers/specs/2026-11-20-cyber-score-dashboard-design.md`.

**Working checkouts:** Repo changes in `/Users/navnn/Documents/AstrowareProjects/promptfoo/.worktrees/cyber-score-dashboard` on `codex/cyber-score-dashboard`. Site source in a new, empty `/Users/navnn/Documents/AstrowareProjects/promptfoo/.worktrees/cyber-score-dashboard-site` checkout created through the Sites workflow. Never commit to or push `main` directly.

## File map

| File                                              | Responsibility                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `plugins/cyber/scoreboard/scoreboard.py`          | Validate versioned registry; append runs/slots and explicitly update current pointers; atomic CLI writes. |
| `plugins/cyber/scoreboard/selftest_scoreboard.py` | Meaningful publisher and append-only regression tests.                                                    |
| `plugins/cyber/scoreboard/scores.json`            | Ten families, construct slots, immutable run history, current pointers.                                   |
| `plugins/cyber/scoreboard/README.md`              | Score semantics, evidence-review and publication commands, update contract.                               |
| Site `dist/index.html`                            | Accessible dashboard structure and controls.                                                              |
| Site `dist/styles.css`                            | Responsive matrix and status treatment.                                                                   |
| Site `dist/data.mjs`                              | Browser-safe registry validation and explicit-pointer selection.                                          |
| Site `dist/app.mjs`                               | Fetch, refresh, stale handling, filters, safe DOM rendering.                                              |
| Site `dist/fallback.json`                         | Dated initial registry snapshot, copied from the validated fork file.                                     |
| Site `test/data.test.mjs`                         | Selection/validation tests for malformed data and distinct constructs.                                    |
| Site `.openai/hosting.json`                       | Site ID and `dist` static directory, written by the Sites helper.                                         |

## Task 1: Registry publisher contract

**Files:** Create `plugins/cyber/scoreboard/scoreboard.py` and `plugins/cyber/scoreboard/selftest_scoreboard.py`.

- [ ] Write `unittest` cases first for valid empty ten-family registry, invalid schema, duplicate run IDs, duplicate current pointers for one `(family_id, slot_id, model_id)`, negative numerator, numerator greater than denominator, missing pinned evidence, bad status, pointer to wrong model/slot, run-to-slot family/side/construct/metric mismatch, negative or over-denominator validity/error counts, change or deletion of an existing run or family identity, an altered existing slot, an additive construct slot, and unknown scored dates. Use temporary files for CLI round trips.
- [ ] Run `python3 plugins/cyber/scoreboard/selftest_scoreboard.py`; expect failures for unimplemented functions.
- [ ] Implement `validate_registry(data, previous=None)` and `append_result(data, submission)`. Require `schema_version == "cyber-scoreboard-v1"`; ten distinct family IDs `f2`–`f11`; unique `(family_id, slot_id)` and `(family_id, slot_id, model_id)` current-pointer keys; unique run IDs; integer `0 <= numerator <= denominator`; `denominator > 0`; required family name, side, construct ID, model, metric/unit, version, status, source commit, evidence commit date, and evidence URL. Require `scored_at` to be an ISO date or `null` if the source does not state the run date; never substitute the evidence commit date. Define optional integer `valid_attempts`, `provider_errors`, `format_failures`, and `invalid_runs`; each must be between zero and the primary denominator when present, without assuming they sum to it across different task semantics. Verify the run's repeated family name, side, construct ID, and primary metric ID against its family and slot. Restrict evidence URLs to immutable `https://github.com/navingate/promptfoo/blob/<40 hex>/<path>` paths. When `previous` is supplied, every old run, old family ID/name, and old slot definition must be unchanged; only new runs/slots and current-pointer changes are allowed.
- [ ] Implement `validate --registry <path>` and `add --registry <path> --input <submission.json> [--current]`. A submission has `{ "slot": optional_new_slot, "run": new_run }`; `--current` sets the exact `(family_id, slot_id, model_id)` pointer to the new run. Write with a temporary file in the same directory and `os.replace`. Reject updates before writing; never repair invalid data silently.
- [ ] Run the focused selftest and `ruff check plugins/cyber/scoreboard` plus `ruff format --check plugins/cyber/scoreboard` when `ruff` is available. If not installed, run `python3 -m compileall -q plugins/cyber/scoreboard` and report the lint limit. Before committing, run the repository's `npm run l` and `npm run f` in a disposable fork-main mirror as described under Execution constraints, then copy any intended formatting back.
- [ ] Commit only these two files with a conventional `feat(cyber): add score registry publisher` commit. Keep pre-commit hooks enabled.

The central invariants should resemble:

```python
from typing import Any, Dict, Optional

def validate_registry(data: Dict[str, Any], previous: Optional[Dict[str, Any]] = None) -> None:
    if data.get("schema_version") != "cyber-scoreboard-v1":
        raise ValueError("unsupported score registry schema")
    # Validate all identifiers, score bounds, links, and current pointers.
    if previous is not None:
        old_runs = {run["run_id"]: run for run in previous["runs"]}
        new_runs = {run["run_id"]: run for run in data["runs"]}
        for run_id, old_run in old_runs.items():
            if new_runs.get(run_id) != old_run:
                raise ValueError(f"prior run changed or removed: {run_id}")
```

## Task 2: Seed and verify current results

**Files:** Create `plugins/cyber/scoreboard/scores.json` and `plugins/cyber/scoreboard/README.md`.

- [ ] Populate the ten family names and slots, including separate F3 detection and response slots. Seed exactly the GLM-5.3 and local-Qwen current pointers listed in the approved spec. Leave F4 defense and unscored GLM-5.3 sides without a current pointer; the page will render them as Pending.
- [ ] For each seed, verify model, endpoint ID, fraction, metric, candidate version, validity counts, status, and immutable URL against the pinned report. Use the GitHub connector or `git show <evidence-commit>:<path>` for every source. Record `scored_at` only when the report states it; otherwise use `null` and the evidence commit date separately. The F10 offense record must retain 28 valid final decisions, 7 format failures, and 1 provider error; its denominator remains 36 planned cases. F3 detection must be `inconclusive` with 7/36 exact and 11/36 valid parsed rules, and its endpoint ID is `cloudflare-workers-ai-glm53-low-paced`. F3 response is a separate 11/36 construct. F4 defense has no score.
- [ ] Use `scored_screen` for unapproved complete GLM-5.3 screens and `local_probe` for local Qwen records. F2's frozen release is `release`; retain its source caveat. Never infer a status from its numerical score.
- [ ] Document one future-run flow: inspect the scored report, write a small submission JSON, run `python3 plugins/cyber/scoreboard/scoreboard.py add --registry plugins/cyber/scoreboard/scores.json --input /path/to/submission.json --current`, validate, commit the changed registry, and push through a feature branch/PR. Document that the page refreshes from committed data and does not see private or uncommitted traces.
- [ ] Run `python3 plugins/cyber/scoreboard/scoreboard.py validate --registry plugins/cyber/scoreboard/scores.json` and the selftest; expect success. Review the data diff against the spec inventory.
- [ ] Commit these files. Push the feature branch to the fork so the Site has a live GitHub source; do not merge into main directly.

The JSON shape is:

```json
{
  "schema_version": "cyber-scoreboard-v1",
  "families": [
    {
      "id": "f3",
      "name": "Workload Identity Cascade",
      "slots": [
        {
          "id": "detection",
          "side": "defense",
          "construct_id": "f3-rule-proof",
          "label": "Detection twin",
          "metric_id": "exact_rule_proof_batch"
        }
      ]
    }
  ],
  "runs": [
    {
      "run_id": "f3-glm53-detection-v10.1",
      "family_id": "f3",
      "family_name": "Workload Identity Cascade",
      "slot_id": "detection",
      "side": "defense",
      "construct_id": "f3-rule-proof",
      "model_id": "glm-5.3",
      "model_label": "GLM-5.3",
      "endpoint_id": "cloudflare-workers-ai-glm53-low-paced",
      "candidate_version": "v10.1",
      "metric": {
        "id": "exact_rule_proof_batch",
        "label": "Exact rule and proof",
        "unit": "batch",
        "numerator": 7,
        "denominator": 36
      },
      "status": "inconclusive",
      "scored_at": null,
      "evidence_committed_at": "2026-11-14",
      "source_commit": "1ebf154cf9192924cf0f21e662ffb22db7e1ebb1",
      "evidence_url": "https://github.com/navingate/promptfoo/blob/779cf41cf814719f971da66583192a6bf9eaeeae/.agents/cyber-benchmarks/F3-V10.1-CLOUDFLARE-GLM53-RESULTS.md",
      "caveat": "Only 11/36 valid parsed rules."
    }
  ],
  "current": [
    {
      "family_id": "f3",
      "slot_id": "detection",
      "model_id": "glm-5.3",
      "run_id": "f3-glm53-detection-v10.1"
    }
  ]
}
```

The example keeps `scored_at` unknown because the report itself does not state a scored date; it records the evidence commit date separately.

## Task 3: Static dashboard behavior

**Files:** Create Site `dist/index.html`, `dist/styles.css`, `dist/data.mjs`, `dist/app.mjs`, `dist/fallback.json`, and `test/data.test.mjs`.

- [ ] Create the new Site through the Sites workflow, persist its returned `project_id` in `.openai/hosting.json` with `static.directory = "dist"`, and open its source checkout using the source helper. Keep the default audience owner-private.
- [ ] Write `node:test` cases first for registry version rejection, missing current run rejection, duplicate current-pointer rejection, run-to-slot metadata mismatch, exact pointer selection, a Pending slot, F7 and F11 offense cells with zero slots rendering Pending, F3's two distinct defense constructs, and no automatic selection of an unpointed higher score.
- [ ] Implement `validateRegistry()` and `currentForSlot()` in `data.mjs` with the same browser-relevant identity/score/pointer invariants as the Python publisher. Show an unknown scored date as "Not reported" and the evidence date separately. No arbitrary HTML from registry fields is trusted.
- [ ] Build `index.html` and responsive `styles.css`: title, last-checked/stale status, model filter defaulting to GLM-5.3, status filter, refresh button, ten family rows, offense/defense columns, construct subcards, evidence links, and expandable run history. Use text labels as well as color for status.
- [ ] Implement `app.mjs`: fetch the GitHub Contents API for `plugins/cyber/scoreboard/scores.json` on `codex/cyber-score-dashboard`, adding a cache-busting query value and `cache: "no-store"` to every request. Request it on load, every five minutes while open, and when the tab regains focus; throttle focus refreshes so at least five minutes pass between successful API requests. Decode the base64 UTF-8 response, validate the complete registry before replacing the current data, and record the last successful check time. On network/shape failure, retain the last verified snapshot or dated bundled fallback and display a visible stale warning. Add a manual refresh control. A side with no slots renders one Pending state, not an empty cell. Build nodes with `textContent` and DOM APIs, not `innerHTML` for data.
- [ ] Copy the validated registry to `dist/fallback.json` with a build-time snapshot date in the Site UI. Test `node --test test/data.test.mjs`; expect pass. Serve locally using the Sites local-preview guidance, then inspect desktop/mobile layout and controls with CUA if available.
- [ ] Commit/package Site source through the Sites helper; do not put credentials or raw model traces in either repository.

## Task 4: Publish and verify the private live page

**Files:** Site source and `.openai/hosting.json`; no new Promptfoo code unless a test reveals a defect.

- [ ] Use the Sites private save-and-deploy tool for the owner-only Site. Poll only if deployment is pending. Record the deployed URL and saved version.
- [ ] Open the deployed page and verify ten families, GLM-5.3 default, F3 construct separation, F4 defense Pending, F10 planned denominator/error detail, Qwen-only local probes, and correct pinned evidence links.
- [ ] Exercise a local test registry update in preview and confirm refresh changes only the intended slot; do not publish fabricated scores to the fork. Verify fetch-failure behavior shows the stale warning and check time.
- [ ] Open a normal PR from `codex/cyber-score-dashboard` into the fork's `main`, following `docs/agents/pr-conventions.md`. The deployed Site reads the feature branch until the PR merges; after merge, point its fetch source to fork `main` and redeploy. Do not delete the live source branch before that switch. Watch CI and fix attributable failures.
- [ ] Report the private URL, PR link, exact score freshness, and the command for publishing the next score. State clearly that the dashboard tracks committed records, not running local evaluations.

## Execution constraints

- Read `plugins/AGENTS.md` and `docs/agents/python.md` for repo files. Use Node from `.nvmrc` before Node checks. The user-supplied `AGENTS.md` requires `npm run l && npm run f` before committing. Run those commands against the changed files in a disposable local clone whose `origin/main` is the fork's main commit; stage only the score dashboard files there. The active worktree's `origin/main` refers to upstream and differs by thousands of unrelated files, so running its broad scripts there would mutate unrelated code. Copy any intended formatting from the mirror back to the active worktree and check the diff. Keep pre-commit hooks enabled in the active worktree.
- Do not edit or expose `.env`; no Site runtime secret is needed. Preserve immutable score records and explicit current pointers. Keep offense and defense denominators and units visible; do not compute a cross-task aggregate.
- Use the Sites skill's source-helper and private deployment sequence. Check the hosted result instead of assuming a successful local preview means publication succeeded.
