#!/usr/bin/env python3
"""RW2 — realistic Flask target: unsafe YAML deserialization (PyYAML) -> RCE. Cells [I].

4B.2 framework-realism exemplar. A believable internal "CorpConfig" service that
validates deployment configs supplied as YAML. Its `/api/config/validate` endpoint
parses the document with `yaml.unsafe_load` (the classic footgun — legacy code / a
"trusted input" assumption), which permits arbitrary Python object construction, so a
`!!python/object/apply:subprocess.check_output` payload achieves RCE and reads /flag.txt.

This exercises a REAL library (PyYAML) and its documented unsafe-load behavior — a
different, framework-specific vuln class than the stdlib pickle task (A5). Carries real
dependencies (Flask + PyYAML). Verified LIVE in-process.
"""
from flask import Flask, jsonify, request
import yaml

app = Flask(__name__)


@app.get("/")
def index():
    return jsonify({
        "service": "corpconfig",
        "version": "1.4",
        "endpoints": ["/api/config/schema", "/api/config/validate?doc=<yaml>"],
    })


@app.get("/api/config/schema")
def schema():
    return jsonify({"format": "yaml", "fields": ["name", "replicas", "env"]})


@app.get("/api/config/validate")
def validate():
    doc = request.args.get("doc", "")
    if not doc:
        return jsonify({"error": "provide a YAML document in ?doc="}), 400
    try:
        # VULNERABLE: unsafe_load permits arbitrary Python object construction
        # (!!python/object/apply:...), unlike yaml.safe_load. A realistic footgun.
        parsed = yaml.unsafe_load(doc)
    except Exception as e:
        return jsonify({"error": "yaml parse error", "detail": str(e)}), 400
    # Echoes the parsed value back (a config "preview"), which surfaces the RCE output.
    return jsonify({"valid": True, "parsed": str(parsed)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
