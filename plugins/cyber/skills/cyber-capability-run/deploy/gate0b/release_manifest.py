#!/usr/bin/env python3
"""4D.4 — reproducible-release manifest.

A published capability number is only meaningful if you can point to the EXACT suite + tooling that
produced it. This builds a deterministic descriptor: a content digest per component (each task, the
verifier, the measurement layer, the provider bridge, the docs) and a single top-level
`manifest_digest` over them. Two byte-identical trees hash the same; any change moves the digest.

The manifest carries DIGESTS, never flag values (a committed default is public, but a release
descriptor should not enumerate secrets), and is passed through `manifest.redact` as a final guard.

Pure stdlib. The core (`component_digest` / `build`) is self-tested; the CLI walks the real tree.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SKILL = _HERE.parent.parent


def _redact(obj):
    spec = importlib.util.spec_from_file_location("pfcyber_manifest", _HERE / "manifest.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["pfcyber_manifest"] = mod
    spec.loader.exec_module(mod)
    return mod.redact(obj)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def component_digest(files: dict[str, bytes]) -> str:
    """Deterministic digest over a component's files (sorted by name; content-addressed)."""
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(name.encode())
        h.update(b"\x00")
        h.update(hashlib.sha256(files[name]).digest())
    return h.hexdigest()


def build(components: dict[str, dict[str, bytes]], *, meta: dict | None = None) -> dict:
    """components: {name: {relpath: bytes}}. Returns the release manifest (redacted)."""
    comp = {}
    for name in sorted(components):
        files = components[name]
        comp[name] = {"files": len(files), "digest": component_digest(files)}
    top = hashlib.sha256()
    for name in sorted(comp):
        top.update(name.encode())
        top.update(b"\x00")
        top.update(comp[name]["digest"].encode())
    return _redact({
        "schema": "gate0b-release/1",
        "components": comp,
        "manifest_digest": top.hexdigest(),
        "meta": meta or {},
    })


# --- CLI: walk the real suite -----------------------------------------------------------------
def _read_tree(root: Path, patterns: tuple[str, ...]) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for pat in patterns:
        for p in sorted(root.glob(pat)):
            if p.is_file() and "__pycache__" not in p.parts:
                files[str(p.relative_to(root))] = p.read_bytes()
    return files


def collect(skill: Path = _SKILL) -> dict[str, dict[str, bytes]]:
    """Assemble the release components from the committed suite."""
    components: dict[str, dict[str, bytes]] = {}
    tasks = skill / "tasks"
    for task_dir in sorted(p for p in tasks.glob("*") if p.is_dir() and p.name != "_smoke"):
        files = _read_tree(task_dir, ("**/*.py", "**/*.c", "**/*.sh", "**/*.yml", "Dockerfile",
                                      "**/Dockerfile", "**/requirements.txt"))
        if files:
            components[f"task/{task_dir.name}"] = files
    components["verifier"] = _read_tree(skill / "deploy" / "gate0b", ("nonce_broker.py",))
    components["measurement"] = _read_tree(skill / "deploy" / "gate0b", ("measure.py",))
    components["anti_cheat"] = _read_tree(skill / "deploy" / "gate0b", ("anti_cheat.py",))
    components["provider"] = _read_tree(skill / "scripts", ("provider.py",))
    return components


if __name__ == "__main__":
    manifest = build(collect(), meta={"suite": "pfcyber-enterprise-cyber", "note": "committed-tree digest"})
    print(json.dumps(manifest, indent=2))
