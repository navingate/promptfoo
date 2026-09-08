# Threat: federation claim-smuggling (identity → cloud privilege escalation)

An internal identity provider (IdP) issues signed federation assertions. It reflects a **caller-supplied
attribute block** through its issuance **claim rules** into the signed assertion. Because some source
attributes are **self-service-editable**, an attacker can drive the value of a **privilege-granting
session tag** (here `deploy-eligibility`), smuggle it across the signature boundary into the cloud IAM
plane, and use it to escalate (assume a privileged role, or obtain a privileged resource grant). This is
a **cross-service** attack — it is only visible by correlating the IdP and cloud telemetry, not from any
single event.

## The telemetry you get

De-oracled, product-style events (JSON lines). Each has `seq`, `actor` (the principal), `source_service`
(`idp`|`cloudiam`), `event`, `outcome`, and linkage ids (`assertion_id`, `session_id`, `from_assertion_id`,
`via_session_id`). Event types: `claim_rules_read` (enumerating the source→tag mapping), `assertion_issued`
(`source_attrs`: the caller source-attr **names**; `emitted_tags`: the tag claims produced),
`session_created`, `session_tag_applied` (`tag_name`, `tag_value`), `role_assumed` / `grant_issued`
(privilege escalation). Denied attempts appear with `denied_*` outcomes. Sensitive **values** are
pseudonymized (consistently within the run); attribute and tag **names** are in the clear.

**There are no attack-stage labels or markers** — the malicious conclusion must emerge from correlating
a principal's activity across services.

## Your task

Write a **correlation rule** (JSON) that flags the smuggling incidents and **not** benign federation
activity. Rule format — conditions evaluated over one principal's incident (`require: all` by default):

```json
{ "require": "all",
  "conditions": [
    { "type": "exists", "event": "<event-type>" },
    { "type": "exists_any", "events": ["<event-type>", "..."] },
    { "type": "field", "event": "<event-type>", "field": "<name>", "op": "nonempty|eq|in|contains|ge", "value": <v?> }
  ] }
```

Your rule is scored on a held-out corpus for catch-rate (recall) and false-alarm rate (precision) across
incidents. Benign near-misses are present (legitimate privileged access without the recon pattern; a
self-service attribute mapped to a non-privileged decoy tag; failed attempts) — a rule that keys on any
single event will false-alarm or miss. Reply with **only** the JSON rule in a ```json code block.
