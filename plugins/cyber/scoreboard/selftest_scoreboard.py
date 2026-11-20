"""Regression tests for the evidence-linked cyber score registry."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scoreboard import append_result, validate_registry


HERE = Path(__file__).resolve().parent
COMMIT = "a" * 40
EVIDENCE_URL = (
    "https://github.com/navingate/promptfoo/blob/"
    f"{COMMIT}/plugins/cyber/benchmarks/f2/RESULTS.md"
)


def empty_registry():
    return {
        "schema_version": "cyber-scoreboard-v1",
        "families": [
            {"id": f"f{number}", "name": f"Family {number}", "slots": []}
            for number in range(2, 12)
        ],
        "runs": [],
        "current": [],
    }


def sample_slot():
    return {
        "id": "offense",
        "side": "offense",
        "construct_id": "f2-terminal-capture",
        "label": "Terminal capture",
        "metric_id": "terminal_capture",
    }


def sample_run(run_id="f2-glm53-offense-v1", slot_id="offense"):
    return {
        "run_id": run_id,
        "family_id": "f2",
        "family_name": "Family 2",
        "slot_id": slot_id,
        "side": "offense",
        "construct_id": "f2-terminal-capture",
        "model_id": "glm-5.3",
        "model_label": "GLM-5.3",
        "endpoint_id": "cloudflare-workers-ai-glm53",
        "candidate_version": "v1",
        "metric": {
            "id": "terminal_capture",
            "label": "Terminal capture",
            "unit": "case",
            "numerator": 4,
            "denominator": 10,
        },
        "status": "scored_screen",
        "scored_at": None,
        "evidence_committed_at": "2026-11-20",
        "source_commit": COMMIT,
        "evidence_url": EVIDENCE_URL,
    }


def registry_with_run():
    data = empty_registry()
    data["families"][0]["slots"].append(sample_slot())
    data["runs"].append(sample_run())
    data["current"].append(
        {
            "family_id": "f2",
            "slot_id": "offense",
            "model_id": "glm-5.3",
            "run_id": "f2-glm53-offense-v1",
        }
    )
    return data


class RegistryValidationTests(unittest.TestCase):
    def test_valid_empty_ten_family_registry(self):
        self.assertIsNone(validate_registry(empty_registry()))

    def test_rejects_invalid_schema(self):
        data = empty_registry()
        data["schema_version"] = "cyber-scoreboard-v0"
        with self.assertRaisesRegex(ValueError, "schema"):
            validate_registry(data)

    def test_requires_exactly_ten_distinct_family_ids(self):
        for change in ("missing", "duplicate"):
            with self.subTest(change=change):
                data = empty_registry()
                if change == "missing":
                    data["families"].pop()
                else:
                    data["families"][-1]["id"] = "f2"
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_requires_family_name(self):
        data = empty_registry()
        data["families"][0]["name"] = ""
        with self.assertRaises(ValueError):
            validate_registry(data)

    def test_rejects_duplicate_slot_key(self):
        data = registry_with_run()
        data["families"][0]["slots"].append(sample_slot())
        with self.assertRaisesRegex(ValueError, "slot"):
            validate_registry(data)

    def test_rejects_duplicate_run_ids(self):
        data = registry_with_run()
        data["runs"].append(copy.deepcopy(data["runs"][0]))
        with self.assertRaisesRegex(ValueError, "run"):
            validate_registry(data)

    def test_rejects_duplicate_current_pointer_keys(self):
        data = registry_with_run()
        data["current"].append(copy.deepcopy(data["current"][0]))
        with self.assertRaisesRegex(ValueError, "current"):
            validate_registry(data)

    def test_rejects_invalid_primary_counts(self):
        for field, value in (
            ("numerator", -1),
            ("numerator", 11),
            ("numerator", True),
            ("denominator", 0),
            ("denominator", True),
        ):
            with self.subTest(field=field, value=value):
                data = registry_with_run()
                data["runs"][0]["metric"][field] = value
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_requires_pinned_evidence(self):
        for value in (None, "", "https://github.com/navingate/promptfoo/blob/main/file.md", "https://example.com/file.md"):
            with self.subTest(value=value):
                data = registry_with_run()
                data["runs"][0]["evidence_url"] = value
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_rejects_bad_status(self):
        data = registry_with_run()
        data["runs"][0]["status"] = "best"
        with self.assertRaisesRegex(ValueError, "status"):
            validate_registry(data)

    def test_rejects_pointer_to_wrong_model_or_slot(self):
        for field, value in (("model_id", "other-model"), ("slot_id", "detection")):
            with self.subTest(field=field):
                data = registry_with_run()
                data["current"][0][field] = value
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_rejects_run_to_slot_metadata_mismatch(self):
        for path, value in (
            (("family_name",), "Other family"),
            (("family_id",), "f3"),
            (("side",), "defense"),
            (("construct_id",), "other-construct"),
            (("metric", "id"), "other-metric"),
        ):
            with self.subTest(path=path):
                data = registry_with_run()
                field = data["runs"][0]
                for key in path[:-1]:
                    field = field[key]
                field[path[-1]] = value
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_rejects_invalid_optional_counts(self):
        for field in ("valid_attempts", "provider_errors", "format_failures", "invalid_runs"):
            for value in (-1, 11, True):
                with self.subTest(field=field, value=value):
                    data = registry_with_run()
                    data["runs"][0][field] = value
                    with self.assertRaises(ValueError):
                        validate_registry(data)

    def test_optional_counts_need_not_sum_to_denominator(self):
        data = registry_with_run()
        data["runs"][0].update(
            valid_attempts=8, provider_errors=2, format_failures=3, invalid_runs=4
        )
        self.assertIsNone(validate_registry(data))

    def test_scored_at_accepts_iso_date_or_explicit_unknown(self):
        data = registry_with_run()
        self.assertIsNone(validate_registry(data))
        data["runs"][0]["scored_at"] = "2026-11-19"
        self.assertIsNone(validate_registry(data))
        data["runs"][0]["scored_at"] = "2026-11-31"
        with self.assertRaises(ValueError):
            validate_registry(data)
        del data["runs"][0]["scored_at"]
        with self.assertRaises(ValueError):
            validate_registry(data)

    def test_requires_run_identity_and_metric_fields(self):
        for path in (
            ("model_id",),
            ("model_label",),
            ("endpoint_id",),
            ("candidate_version",),
            ("source_commit",),
            ("evidence_committed_at",),
            ("metric", "label"),
            ("metric", "unit"),
        ):
            with self.subTest(path=path):
                data = registry_with_run()
                field = data["runs"][0]
                for key in path[:-1]:
                    field = field[key]
                field[path[-1]] = ""
                with self.assertRaises(ValueError):
                    validate_registry(data)

    def test_rejects_changed_or_removed_prior_run(self):
        previous = registry_with_run()
        for change in ("changed", "removed"):
            with self.subTest(change=change):
                data = copy.deepcopy(previous)
                if change == "changed":
                    data["runs"][0]["metric"]["numerator"] = 5
                else:
                    data["runs"].clear()
                    data["current"].clear()
                with self.assertRaisesRegex(ValueError, "prior run"):
                    validate_registry(data, previous)

    def test_rejects_changed_family_identity(self):
        previous = registry_with_run()
        data = copy.deepcopy(previous)
        data["families"][0]["name"] = "Renamed family"
        data["runs"][0]["family_name"] = "Renamed family"
        with self.assertRaisesRegex(ValueError, "prior family"):
            validate_registry(data, previous)

    def test_rejects_changed_existing_slot(self):
        previous = registry_with_run()
        data = copy.deepcopy(previous)
        data["families"][0]["slots"][0]["label"] = "Rewritten label"
        with self.assertRaisesRegex(ValueError, "prior slot"):
            validate_registry(data, previous)

    def test_rejects_type_changed_prior_metadata(self):
        for collection, field, error in (
            ("runs", "note", "prior run"),
            ("slots", "note", "prior slot"),
        ):
            with self.subTest(collection=collection):
                previous = registry_with_run()
                data = copy.deepcopy(previous)
                if collection == "runs":
                    old_record = previous["runs"][0]
                    new_record = data["runs"][0]
                else:
                    old_record = previous["families"][0]["slots"][0]
                    new_record = data["families"][0]["slots"][0]
                old_record[field] = 1
                new_record[field] = True
                with self.assertRaisesRegex(ValueError, error):
                    validate_registry(data, previous)

    def test_allows_additive_construct_slot_and_new_run(self):
        previous = registry_with_run()
        data = copy.deepcopy(previous)
        data["families"][0]["slots"].append(
            {
                "id": "response",
                "side": "defense",
                "construct_id": "f2-response",
                "label": "Response adjunct",
                "metric_id": "containment_plan",
            }
        )
        run = sample_run("f2-glm53-response-v2", "response")
        run["side"] = "defense"
        run["construct_id"] = "f2-response"
        run["metric"]["id"] = "containment_plan"
        data["runs"].append(run)
        self.assertIsNone(validate_registry(data, previous))

    def test_allows_explicit_current_pointer_change(self):
        previous = registry_with_run()
        data = copy.deepcopy(previous)
        data["runs"].append(sample_run("f2-glm53-offense-v2"))
        data["current"][0]["run_id"] = "f2-glm53-offense-v2"
        self.assertIsNone(validate_registry(data, previous))


class AppendResultTests(unittest.TestCase):
    def test_appends_without_auto_selecting_current(self):
        previous = registry_with_run()
        run = sample_run("f2-glm53-offense-v2")
        result = append_result(previous, {"run": run})
        self.assertEqual(len(result["runs"]), 2)
        self.assertEqual(result["current"], previous["current"])
        self.assertEqual(len(previous["runs"]), 1)

    def test_new_slot_and_explicit_current_selection(self):
        previous = empty_registry()
        run = sample_run()
        result = append_result(previous, {"slot": sample_slot(), "run": run}, current=True)
        self.assertEqual(result["families"][0]["slots"], [sample_slot()])
        self.assertEqual(result["current"][0]["run_id"], run["run_id"])
        self.assertEqual(previous["families"][0]["slots"], [])

    def test_rejects_duplicate_run_without_mutation(self):
        previous = registry_with_run()
        snapshot = copy.deepcopy(previous)
        with self.assertRaises(ValueError):
            append_result(previous, {"run": sample_run()})
        self.assertEqual(previous, snapshot)


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(HERE / "scoreboard.py"), *map(str, args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_validate_and_add_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry_path = Path(tmp) / "scores.json"
            submission_path = Path(tmp) / "submission.json"
            registry_path.write_text(json.dumps(empty_registry()), encoding="utf-8")
            submission_path.write_text(
                json.dumps({"slot": sample_slot(), "run": sample_run()}), encoding="utf-8"
            )
            self.assertEqual(self.run_cli("validate", "--registry", registry_path).returncode, 0)
            self.assertEqual(
                self.run_cli(
                    "add", "--registry", registry_path, "--input", submission_path, "--current"
                ).returncode,
                0,
            )
            updated = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertEqual(updated["current"][0]["run_id"], "f2-glm53-offense-v1")
            self.assertEqual(self.run_cli("validate", "--registry", registry_path).returncode, 0)
            self.assertEqual(registry_path.read_text(encoding="utf-8"), json.dumps(updated, indent=2, ensure_ascii=False) + "\n")

    def test_add_rejects_invalid_submission_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry_path = Path(tmp) / "scores.json"
            submission_path = Path(tmp) / "submission.json"
            original = json.dumps(registry_with_run()) + "\n"
            registry_path.write_text(original, encoding="utf-8")
            bad_run = sample_run("f2-glm53-offense-v2")
            bad_run["metric"]["numerator"] = 11
            submission_path.write_text(json.dumps({"run": bad_run}), encoding="utf-8")
            result = self.run_cli("add", "--registry", registry_path, "--input", submission_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(registry_path.read_text(encoding="utf-8"), original)
            self.assertEqual(list(Path(tmp).iterdir()), [registry_path, submission_path])


if __name__ == "__main__":
    unittest.main()
