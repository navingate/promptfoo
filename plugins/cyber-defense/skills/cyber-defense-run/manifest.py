#!/usr/bin/env python3
"""The DefenseTask contract: parse and validate a defense.yml task manifest.

This is the defense analogue of the offense catalog's task definition — a schema layered
on the reused harness, not a new framework. It is intentionally small: a dataclass, a
mapping parser, and a `validate()` that enforces the one invariant the whole benchmark
rests on (spec §4/§5): a task MUST carry non-empty `objective_checks` AND
`constraint_checks`. That single rule turns "two-sided" from a convention into something
the loader refuses to skip.

`validate()` operates on the parsed dataclass and uses only the standard library, so the
core invariant can be self-tested without PyYAML (see selftest_manifest.py). Reading the
YAML file itself needs PyYAML, matching the offense harness's own dependency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ManifestError(ValueError):
    """A DefenseTask manifest violates the contract (e.g. an empty check bucket)."""


VALID_LAYERS = {"L1", "L2", "L3", "L4"}
VALID_PHASES = {"observe", "investigate", "diagnose", "act", "verify"}
# A check reports an OBJECTIVE failure class; it never guesses *why* the model failed.
VALID_ON_FAILURE = {
    "security_failure",
    "utility_failure",
    "consistency_failure",
    "anti_cheat_failure",
    "invalid",
}


@dataclass
class Check:
    id: str
    verifier: str
    expects: str
    gate: bool = False
    weight: float = 1.0
    depends_on: list[str] = field(default_factory=list)
    on_failure: str = "invalid"

    @staticmethod
    def from_mapping(m: dict[str, Any]) -> "Check":
        return Check(
            id=m["id"],
            verifier=m["verifier"],
            expects=m["expects"],
            gate=bool(m.get("gate", False)),
            weight=float(m.get("weight", 1.0)),
            depends_on=list(m.get("depends_on", []) or []),
            on_failure=m.get("on_failure", "invalid"),
        )


@dataclass
class DefenseTask:
    id: str
    version: str
    capability: dict[str, Any]
    environment: dict[str, Any]
    evidence: dict[str, Any]
    objective: str
    allowed_actions: list[str]
    oracle: dict[str, Any]
    objective_checks: list[Check]
    constraint_checks: list[Check]
    anti_cheat_checks: list[Check]
    scoring: dict[str, Any]
    taxonomy: dict[str, Any]

    @staticmethod
    def from_mapping(m: dict[str, Any]) -> "DefenseTask":
        verifier = m.get("verifier", {}) or {}

        def checks(key: str) -> list[Check]:
            return [Check.from_mapping(c) for c in (verifier.get(key) or [])]

        return DefenseTask(
            id=m["id"],
            version=str(m.get("version", "0")),
            capability=m.get("capability", {}) or {},
            environment=m.get("environment", {}) or {},
            evidence=m.get("evidence", {}) or {},
            objective=m.get("objective", ""),
            allowed_actions=list(m.get("allowed_actions", []) or []),
            oracle=m.get("oracle", {}) or {},
            objective_checks=checks("objective_checks"),
            constraint_checks=checks("constraint_checks"),
            anti_cheat_checks=checks("anti_cheat_checks"),
            scoring=m.get("scoring", {}) or {},
            taxonomy=m.get("taxonomy", {}) or {},
        )


def validate(task: DefenseTask) -> None:
    """Raise ManifestError if the task violates the DefenseTask contract. Stdlib-only."""
    if not task.id:
        raise ManifestError("task.id is required")
    layer = task.capability.get("layer")
    if layer not in VALID_LAYERS:
        raise ManifestError(f"capability.layer must be one of {sorted(VALID_LAYERS)}, got {layer!r}")
    for ph in task.capability.get("phases", []) or []:
        if ph not in VALID_PHASES:
            raise ManifestError(f"capability.phases has unknown phase {ph!r}")

    # THE invariant: two-sided verification is mandatory and cannot be empty.
    if not task.objective_checks:
        raise ManifestError(f"task {task.id!r}: objective_checks must be non-empty (two-sided invariant)")
    if not task.constraint_checks:
        raise ManifestError(f"task {task.id!r}: constraint_checks must be non-empty (two-sided invariant)")

    for bucket_name, bucket in (
        ("objective_checks", task.objective_checks),
        ("constraint_checks", task.constraint_checks),
        ("anti_cheat_checks", task.anti_cheat_checks),
    ):
        for c in bucket:
            if not c.id or not c.verifier:
                raise ManifestError(f"{bucket_name}: every check needs an id and a verifier")
            if c.on_failure not in VALID_ON_FAILURE:
                raise ManifestError(
                    f"check {c.id!r}: on_failure {c.on_failure!r} must be one of {sorted(VALID_ON_FAILURE)}"
                )


def load_task(task_dir: str | Path) -> DefenseTask:
    """Load and validate the defense.yml in `task_dir`. Requires PyYAML (harness venv)."""
    import yaml  # deferred: only the file-load path needs it; validate() does not

    task_dir = Path(task_dir)
    with open(task_dir / "defense.yml", encoding="utf-8") as fh:
        mapping = yaml.safe_load(fh)
    task = DefenseTask.from_mapping(mapping)
    validate(task)
    return task
