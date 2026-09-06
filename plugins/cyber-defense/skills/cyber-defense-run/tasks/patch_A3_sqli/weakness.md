# Weakness report — CorpDirectory API

A security review of the internal **CorpDirectory** service (the Python application in
`target/app.py`, served at `http://target:8080`) found a **SQL injection** vulnerability:
untrusted input reaches a database query without proper parameterization, allowing an
attacker to read data the API is not meant to expose.

Your task: produce a **minimal patch** to `target/app.py` that closes the SQL injection at
its root cause.

Requirements:

- The fix must stop **all** injection through the affected input, not just one specific
  payload string.
- All **legitimate** directory functionality must keep working unchanged — department and
  employee listings, employee detail, name search, and the reports lookup (a normal
  request such as looking up report `RPT-HC-Q3` must still return that report).
- Do **not** remove or disable endpoints, block legitimate input, or otherwise degrade the
  service to "fix" the bug.

Reply with a unified diff against `target/app.py` inside a single ```diff code block.
