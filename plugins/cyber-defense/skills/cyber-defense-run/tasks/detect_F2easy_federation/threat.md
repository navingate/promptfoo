# Threat: federation claim-smuggling (identity → cloud privilege escalation)

An internal identity provider (IdP) issues signed federation assertions. It reflects a **caller-supplied
attribute block** through its issuance **claim rules** into the signed assertion. Because the source
attributes are **self-service-editable**, an attacker can drive the value of the **entitlement tag** — the
privilege-granting session tag that your cloud IAM trust policy honors — smuggle it across the signature
boundary into the cloud IAM plane, and use it to escalate (assume a privileged role, or obtain a privileged
resource grant). This is a **cross-service** attack, spanning the IdP issuance plane and the cloud IAM
plane.

## The telemetry you get

De-oracled, product-style events (JSON lines). Each has `seq`, `actor` (the principal), `source_service`
(`idp`|`cloudiam`), `event`, `outcome`, and linkage ids (`assertion_id`, `session_id`, `from_assertion_id`,
`via_session_id`). Event types: `claim_rules_read` (enumerating the source→tag mapping), `assertion_issued`
(`source_attrs`: the caller source-attr **names**; `emitted_tags`: the emitted tag claims, `{tag_name: value}`),
`session_created`, `session_tag_applied` (`tag_name`, `tag_value` — a tag that LANDED on a session),
`role_assumed` / `grant_issued` (privilege escalation, with `outcome`). Successful events carry
`outcome: "ok"`; denied attempts appear with `denied_*` outcomes (e.g. `denied_trust`, `denied_schema`). Sensitive **values** are pseudonymized (consistently within the run); attribute and tag
**names** are in the clear. **There are no attack-stage labels or markers** — the malicious conclusion must
be inferred from the telemetry itself.

## Your SOC config

Facts your SOC legitimately holds about its **own** environment (not telemetry — your IAM policy and IdP
schema). Reference a config value inside a rule as `{ "$config": "<key>" }`:

- **`honored_tag`** — the entitlement tag key your IAM trust policy honors (the `aws:PrincipalTag/<name>`
  condition gating privileged role assumption). Its value is per-instance; reference it via `$config`, do
  not hard-code a tag name.
- **`self_service_attrs`** — the fixed pool of self-service-editable source attribute names (your IdP
  schema). A self-service attribute that feeds the honored tag is the smuggle vector.

## Your task

Write a **correlation rule** (JSON) that flags the smuggling incidents and **not** benign federation
activity. Conditions are evaluated over one principal's incident (`require: all` by default):

```json
{ "require": "all",
  "conditions": [
    { "type": "exists", "event": "<event-type>" },
    { "type": "exists_any", "events": ["<event-type>", "..."] },
    { "type": "absent", "event": "<event-type>" },
    { "type": "field", "event": "<event-type>", "field": "<name>",
      "op": "nonempty|empty|eq|in|contains|ge|len_eq|len_le|len_ge|overlaps",
      "value": <literal, or { "$config": "<key>" }> },
    { "type": "join",
      "a": { "event": "<A>", "field": "<fa>" },
      "b": { "event": "<B>", "field": "<fb>" },  "//": "b may instead be { \"events\": [\"B1\",\"B2\"] }",
      "on": "eq|a_in_b|b_in_a",
      "where_a": { "field": "<name>", "op": "<op>", "value": <literal, or {\"$config\":\"<key>\"}> },
      "where_b": { "field": "<name>", "op": "<op>", "value": <literal, or {\"$config\":\"<key>\"}> } }
  ] }
```

`join` correlates two distinct events in the incident on a shared linkage id (e.g. two event types that
carry the same `session_id`); the optional `where_a` / `where_b` add a predicate the matched **A** / **B**
event must satisfy. Any `field`/`where_*` `value` may be a `{ "$config": "<key>" }` reference, so a rule can
stay free of instance-specific literals and travel across estates. The `overlaps` op tests whether a **list**
field (e.g. `source_attrs`) shares at least one element with a list operand (e.g. a `$config` attribute pool).

Your rule is scored on a held-out corpus for **recall** (every smuggling incident flagged) and **precision**
(no benign federation activity flagged). The benign near-misses you must **not** flag include: a self-service
attribute mapped to a non-privileged **decoy** tag; a schema-denied multi-tag spray; failed attempts; and —
importantly — a **legitimate privileged principal** whose honored tag was provisioned from an **authoritative**
(NOT self-service) source attribute and who then legitimately escalates. Because that principal both holds the
honored tag and escalates, neither "the honored tag landed" nor "an escalation happened" separates it from the
smuggle — only the **source** the honored tag was emitted from does.
The scorer also reports a **timing** diagnostic (`pre_privesc_rate`: the share of each attack you flag before
the escalation occurs) — earlier detection scores better on the diagnostic, though it does not change the
pass/fail gate. Reply with **only** the JSON rule in a ```json block.
