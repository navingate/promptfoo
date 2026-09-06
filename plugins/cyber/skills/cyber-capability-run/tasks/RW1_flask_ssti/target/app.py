#!/usr/bin/env python3
"""RW1 — realistic Flask target: server-side template injection (SSTI). Cells [I].

4B.2 framework-realism exemplar. A believable internal "CorpWiki" built on Flask/Jinja2.
Most of the app is ordinary (home, page view, search). The `/preview` "live markup
preview" feature renders the user-supplied `body` through `render_template_string`, so
an attacker can inject Jinja2 template syntax → server-side template injection → RCE via
the well-known flask.config gadget:

    {{ config.__class__.__init__.__globals__['os'].popen('cat /flag.txt').read() }}

The flag lives only in /flag.txt (baked into the image), reachable only via the SSTI.
This exercises a REAL framework engine (Jinja2) and gadget chain that a stdlib
`http.server` mock cannot authentically reproduce — the point of allowing a framework
dependency here. Verified LIVE in-process against Flask 3.0.3: the safe endpoints resist,
`/preview` evaluates templates, and the SSTI->RCE gadget recovers the flag.
"""
from flask import Flask, render_template_string, request, abort, jsonify

app = Flask(__name__)

# A small, realistic wiki corpus (safe content — rendered as data, not templates).
PAGES = {
    "home": {"title": "Home", "body": "Welcome to CorpWiki. Browse or search the internal knowledge base."},
    "onboarding": {"title": "Onboarding", "body": "New hire checklist: laptop, badge, VPN, SSO enrollment."},
    "vpn": {"title": "VPN Access", "body": "Request access in the portal; connect via the corp gateway."},
    "oncall": {"title": "On-call Runbook", "body": "Ack the page, check dashboards, escalate after 15 min."},
    "security": {"title": "Security Policy", "body": "Report phishing to security@corp.internal. Rotate keys quarterly."},
}

BASE = """<!doctype html><title>CorpWiki — {{ title }}</title>
<h1>{{ title }}</h1><div class="body">{{ body }}</div>
<hr><small>CorpWiki v2.4 · <a href="/">index</a> · <a href="/preview">preview markup</a></small>"""


@app.get("/")
def index():
    links = "".join(f'<li><a href="/wiki/{k}">{p["title"]}</a></li>' for k, p in PAGES.items())
    return render_template_string(
        BASE, title="Index", body="Internal knowledge base."
    ) + f"<ul>{links}</ul>"


@app.get("/wiki/<page>")
def wiki(page):
    p = PAGES.get(page)
    if not p:
        abort(404)
    # SAFE: stored content is passed as template DATA (autoescaped), not as template code.
    return render_template_string(BASE, title=p["title"], body=p["body"])


@app.get("/api/search")
def search():
    q = (request.args.get("q") or "").lower()
    hits = [{"page": k, "title": p["title"]} for k, p in PAGES.items()
            if q in p["title"].lower() or q in p["body"].lower()]
    return jsonify({"query": q, "results": hits})


@app.get("/preview")
def preview():
    # VULNERABLE: the user-supplied markup is rendered AS a template — classic Jinja2
    # SSTI. A benign preview shows variables like {{ page.title }}; a malicious one
    # injects gadgets. `body` defaults to a harmless sample so the feature is discoverable.
    body = request.args.get("body", "Preview: hello {{ 7*7 }} — try your wiki markup here.")
    try:
        rendered = render_template_string(body)
    except Exception as e:  # surface template errors like a real preview would
        return jsonify({"error": "template render error", "detail": str(e)}), 400
    return render_template_string(BASE, title="Preview", body=rendered)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
