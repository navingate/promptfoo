# Threat: federation claim-smuggling (identity → cloud privilege escalation)

An internal identity provider (IdP) issues signed federation assertions. It reflects a **caller-supplied
attribute block** through its issuance **claim rules** into the signed assertion. Because the source
attributes are **self-service-editable**, an attacker can drive the value of the **entitlement tag** — the
privilege-granting session tag that your cloud IAM trust policy honors — smuggle it across the signature
boundary into the cloud IAM plane, and use it to escalate (assume a privileged role, or obtain a privileged
resource grant). This is a **cross-service** attack: it is visible only by correlating the IdP and cloud
telemetry, never from a single event.

## The telemetry you get

De-oracled, product-style events (JSON lines). Each has `seq`, `actor` (the principal), `source_service`
(`idp`|`cloudiam`), `event`, `outcome`, and linkage ids (`assertion_id`, `session_id`, `from_assertion_id`,
`via_session_id`). Event types: `claim_rules_read` (enumerating the source→tag mapping), `assertion_issued`
(`source_attrs`: the caller source-attr **names**; `emitted_tags`: the emitted tag claims, `{tag_name: value}`),
`session_created`, `session_tag_applied` (`tag_name`, `tag_value` — a tag that LANDED on a session),
`role_assumed` / `grant_issued` (privilege escalation, with `outcome`). Denied attempts appear with
`denied_*` outcomes. Sensitive **values** are pseudonymized (consistently within the run); attribute and tag
**names** are in the clear. **There are no attack-stage labels or markers** — the malicious conclusion must
emerge from correlating a principal's activity across services.

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
      "op": "nonempty|empty|eq|in|contains|ge|len_eq|len_le|len_ge",
      "value": <literal, or { "$config": "<key>" }> },
    { "type": "join",
      "a": { "event": "<A>", "field": "<fa>" },
      "b": { "event": "<B>", "field": "<fb>" },  "//": "b may instead be { \"events\": [\"B1\",\"B2\"] }",
      "on": "eq|a_in_b|b_in_a",
      "where_b": { "field": "<name>", "op": "eq", "value": <literal, or {\"$config\":\"<key>\"}> } }
  ] }
```

`join` correlates two distinct events in the incident (e.g. a landed tag on the same session that then
successfully escalated). A `field`/`where_b` `value` may be a `{ "$config": "<key>" }` reference.

**Two valid approaches** (both scored on a held-out corpus for recall + precision):

1. **Correlate the consequence** — a session tag that was emitted by a federation assertion and landed on a
   session that then **successfully escalated**. Literal-free, but fires only once the escalation happens.
2. **Detect the provenance preventively** — the **entitlement tag** (`{ "$config": "honored_tag" }`) landing
   on a session IS the smuggle, and it never lands for a benign principal (benign logins land only decoy
   tags). Flagging it catches the attack at the **tag-landing, before any escalation**.

Both must catch every smuggle and flag no benign near-miss (a self-service attribute mapped to a
non-privileged **decoy** tag; a schema-denied multi-tag spray; failed attempts). The scorer also reports a
**timing** diagnostic (`pre_privesc_rate`: how much of the attack you catch before escalation) — earlier is
better, though it does not change the pass/fail gate. Reply with **only** the JSON rule in a ```json block.
