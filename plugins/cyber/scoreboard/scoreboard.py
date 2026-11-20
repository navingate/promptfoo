"""Publish an append-only, evidence-linked cyber benchmark score registry."""

import argparse
import copy
import json
import os
import re
import stat
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional


SCHEMA_VERSION = "cyber-scoreboard-v1"
FAMILY_IDS = {f"f{number}" for number in range(2, 12)}
STATUSES = {"release", "scored_screen", "local_probe", "inconclusive"}
SIDES = {"offense", "defense"}
OPTIONAL_COUNTS = ("valid_attempts", "provider_errors", "format_failures", "invalid_runs")
COMMIT_PATTERN = re.compile(r"[0-9a-fA-F]{40}")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
EVIDENCE_PATTERN = re.compile(
    r"https://github\.com/navingate/promptfoo/blob/"
    r"[0-9a-fA-F]{40}/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+"
)


def _object(value: Any, location: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{location} must be an object")
    return value


def _array(value: Any, location: str) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{location} must be an array")
    return value


def _text(record: Dict[str, Any], key: str, location: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"{location}.{key} must be non-empty text")
    return value


def _integer(record: Dict[str, Any], key: str, location: str) -> int:
    value = record.get(key)
    if type(value) is not int:
        raise ValueError(f"{location}.{key} must be an integer")
    return value


def _date(value: Any, location: str, allow_unknown: bool = False) -> None:
    if allow_unknown and value is None:
        return
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise ValueError(f"{location} must be an ISO date")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{location} must be an ISO date") from exc


def _same_json(left: Any, right: Any) -> bool:
    """Compare immutable records without treating JSON booleans as numbers."""
    options = {"sort_keys": True, "ensure_ascii": False, "separators": (",", ":"), "allow_nan": False}
    return json.dumps(left, **options) == json.dumps(right, **options)


def _validate_shape(data: Dict[str, Any]) -> None:
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported score registry schema")

    families = _array(data.get("families"), "families")
    if len(families) != len(FAMILY_IDS):
        raise ValueError("families must contain exactly f2 through f11")

    family_by_id = {}
    slot_by_key = {}
    for index, value in enumerate(families):
        family = _object(value, f"families[{index}]")
        family_id = _text(family, "id", f"families[{index}]")
        _text(family, "name", f"families[{index}]")
        if family_id in family_by_id:
            raise ValueError(f"duplicate family id: {family_id}")
        family_by_id[family_id] = family
        for slot_index, slot_value in enumerate(_array(family.get("slots"), "family slots")):
            location = f"families[{index}].slots[{slot_index}]"
            slot = _object(slot_value, location)
            slot_id = _text(slot, "id", location)
            side = _text(slot, "side", location)
            if side not in SIDES:
                raise ValueError(f"{location}.side must be offense or defense")
            _text(slot, "construct_id", location)
            _text(slot, "label", location)
            _text(slot, "metric_id", location)
            key = (family_id, slot_id)
            if key in slot_by_key:
                raise ValueError(f"duplicate slot: {key}")
            slot_by_key[key] = slot
    if set(family_by_id) != FAMILY_IDS:
        raise ValueError("families must contain exactly f2 through f11")

    run_by_id = {}
    for index, value in enumerate(_array(data.get("runs"), "runs")):
        location = f"runs[{index}]"
        run = _object(value, location)
        run_id = _text(run, "run_id", location)
        if run_id in run_by_id:
            raise ValueError(f"duplicate run id: {run_id}")
        run_by_id[run_id] = run
        family_id = _text(run, "family_id", location)
        family_name = _text(run, "family_name", location)
        slot_id = _text(run, "slot_id", location)
        side = _text(run, "side", location)
        construct_id = _text(run, "construct_id", location)
        _text(run, "model_id", location)
        _text(run, "model_label", location)
        _text(run, "endpoint_id", location)
        _text(run, "candidate_version", location)
        metric = _object(run.get("metric"), f"{location}.metric")
        metric_id = _text(metric, "id", f"{location}.metric")
        _text(metric, "label", f"{location}.metric")
        _text(metric, "unit", f"{location}.metric")
        numerator = _integer(metric, "numerator", f"{location}.metric")
        denominator = _integer(metric, "denominator", f"{location}.metric")
        if denominator <= 0 or numerator < 0 or numerator > denominator:
            raise ValueError(f"{location}.metric has invalid score bounds")
        for field in OPTIONAL_COUNTS:
            if field in run:
                count = _integer(run, field, location)
                if count < 0 or count > denominator:
                    raise ValueError(f"{location}.{field} must be within the denominator")
        status = _text(run, "status", location)
        if status not in STATUSES:
            raise ValueError(f"{location}.status is invalid")
        if "scored_at" not in run:
            raise ValueError(f"{location}.scored_at must be an ISO date or null")
        _date(run["scored_at"], f"{location}.scored_at", allow_unknown=True)
        _date(run.get("evidence_committed_at"), f"{location}.evidence_committed_at")
        source_commit = _text(run, "source_commit", location)
        if not COMMIT_PATTERN.fullmatch(source_commit):
            raise ValueError(f"{location}.source_commit must be a 40-character commit")
        evidence_url = _text(run, "evidence_url", location)
        if not EVIDENCE_PATTERN.fullmatch(evidence_url):
            raise ValueError(f"{location}.evidence_url must pin a fork commit and path")
        evidence_path = evidence_url.split("/blob/", 1)[1].split("/", 1)[1]
        if any(part in (".", "..") for part in evidence_path.split("/")):
            raise ValueError(f"{location}.evidence_url contains an unsafe path")
        if "caveat" in run:
            _text(run, "caveat", location)

        family = family_by_id.get(family_id)
        slot = slot_by_key.get((family_id, slot_id))
        if family is None or slot is None:
            raise ValueError(f"{location} references an unknown family or slot")
        if family_name != family["name"]:
            raise ValueError(f"{location}.family_name does not match its family")
        if (side, construct_id, metric_id) != (
            slot["side"],
            slot["construct_id"],
            slot["metric_id"],
        ):
            raise ValueError(f"{location} does not match its slot metadata")

    current_keys = set()
    for index, value in enumerate(_array(data.get("current"), "current")):
        location = f"current[{index}]"
        pointer = _object(value, location)
        family_id = _text(pointer, "family_id", location)
        slot_id = _text(pointer, "slot_id", location)
        model_id = _text(pointer, "model_id", location)
        run_id = _text(pointer, "run_id", location)
        key = (family_id, slot_id, model_id)
        if key in current_keys:
            raise ValueError(f"duplicate current pointer: {key}")
        current_keys.add(key)
        if (family_id, slot_id) not in slot_by_key:
            raise ValueError(f"{location} references an unknown slot")
        run = run_by_id.get(run_id)
        if run is None or key != (run["family_id"], run["slot_id"], run["model_id"]):
            raise ValueError(f"{location} does not match its run family, slot, and model")


def validate_registry(data: Dict[str, Any], previous: Optional[Dict[str, Any]] = None) -> None:
    """Reject malformed registries and changes to previously published records."""
    _validate_shape(_object(data, "registry"))
    if previous is None:
        return
    _validate_shape(_object(previous, "previous registry"))

    old_families = {family["id"]: family for family in previous["families"]}
    new_families = {family["id"]: family for family in data["families"]}
    if [family["id"] for family in data["families"]] != [
        family["id"] for family in previous["families"]
    ]:
        raise ValueError("prior family order changed")
    for family_id, old_family in old_families.items():
        new_family = new_families.get(family_id)
        if new_family is None or new_family["name"] != old_family["name"]:
            raise ValueError(f"prior family changed or removed: {family_id}")
        new_slots = new_family["slots"]
        for index, old_slot in enumerate(old_family["slots"]):
            if index >= len(new_slots) or not _same_json(new_slots[index], old_slot):
                raise ValueError(f"prior slot changed or removed: {family_id}/{old_slot['id']}")

    new_runs = data["runs"]
    for index, old_run in enumerate(previous["runs"]):
        if index >= len(new_runs) or not _same_json(new_runs[index], old_run):
            raise ValueError(f"prior run changed or removed: {old_run['run_id']}")


def append_result(
    data: Dict[str, Any], submission: Dict[str, Any], current: bool = False
) -> Dict[str, Any]:
    """Append one normalized run and optionally select it as the current result."""
    validate_registry(data)
    submission = _object(submission, "submission")
    run = _object(submission.get("run"), "submission.run")
    result = copy.deepcopy(data)
    new_run = copy.deepcopy(run)
    if "slot" in submission:
        new_slot = _object(submission["slot"], "submission.slot")
        family_id = _text(new_run, "family_id", "submission.run")
        family = next((item for item in result["families"] if item["id"] == family_id), None)
        if family is None:
            raise ValueError(f"submission.run references unknown family: {family_id}")
        family["slots"].append(copy.deepcopy(new_slot))
    result["runs"].append(new_run)
    if current:
        pointer = {
            "family_id": _text(new_run, "family_id", "submission.run"),
            "slot_id": _text(new_run, "slot_id", "submission.run"),
            "model_id": _text(new_run, "model_id", "submission.run"),
            "run_id": _text(new_run, "run_id", "submission.run"),
        }
        for index, old_pointer in enumerate(result["current"]):
            if all(old_pointer[field] == pointer[field] for field in ("family_id", "slot_id", "model_id")):
                result["current"][index] = pointer
                break
        else:
            result["current"].append(pointer)
    validate_registry(result, previous=data)
    return result


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def _write_json_atomic(path: Path, data: Dict[str, Any]) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary_name, stat.S_IMODE(path.stat().st_mode))
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="validate a score registry")
    validate.add_argument("--registry", type=Path, required=True)
    add = commands.add_parser("add", help="append one reviewed score result")
    add.add_argument("--registry", type=Path, required=True)
    add.add_argument("--input", type=Path, required=True)
    add.add_argument("--current", action="store_true", help="select the new run as current")
    arguments = parser.parse_args()
    try:
        data = _load_json(arguments.registry)
        if arguments.command == "validate":
            validate_registry(data)
            print(f"valid score registry: {arguments.registry}")
        else:
            submission = _load_json(arguments.input)
            updated = append_result(data, submission, current=arguments.current)
            _write_json_atomic(arguments.registry, updated)
            print(f"updated score registry: {arguments.registry}")
    except (OSError, ValueError) as exc:
        print(f"scoreboard: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
