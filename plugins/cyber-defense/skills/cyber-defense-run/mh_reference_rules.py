"""Literal-free reference detectors in the FROZEN grammar (field/join/exists + flat $config).
h4 provenance and h5b assurance are expressible; h5 scope + output-sink are recorded as FINDINGS
(they need field-vs-field non-membership the grammar lacks — do NOT extend the grammar, §18)."""

# h4: a landed entitlement tag whose emitting assertion drew from a self-service source attr.
# (Keys on ONE security-sensitive tag from a caller-editable attr — it does NOT reconstruct the full
# attacker-supplied tuple, per the design review.)
H4_PROVENANCE = {
    "require": "all",
    "conditions": [
        {"type": "join",
         "a": {"event": "session_tag_applied", "field": "tag_name"},
         "b": {"event": "assertion_issued", "field": "emitted_tags"},
         "on": "a_in_b",
         "where_a": {"field": "tag_name", "op": "in", "value": {"$config": "entitlement_tag_names"}},
         "where_b": {"field": "source_attrs", "op": "overlaps",
                     "value": {"$config": "self_service_attribute_names"}}},
    ],
}

# h5b: a KMS unwrap whose step-up credential was minted WITHOUT assurance evidence (independent of h4).
H5B_ASSURANCE = {
    "require": "all",
    "conditions": [
        {"type": "join",
         "a": {"event": "kms_unwrap", "field": "auth_context_ref"},
         "b": {"event": "stepup_minted", "field": "auth_context_ref"},
         "on": "eq",
         "where_b": {"field": "assurance_evidence", "op": "empty"}},
    ],
}

# h5 scope + output-sink: the VIOLATION is a field-vs-field NON-membership
# (requested_action NOT in authorized_actions; requested_resource_ref != authorized_resource_ref;
# recipient_type NOT in approved sinks). The frozen grammar has on:eq and a_in_b/b_in_a (positive)
# only — no neq/not_in/absent-from — so these VIOLATIONS cannot be written without inverting polarity.
# Recorded as findings; a denylist-config workaround reintroduces an answer-key oracle. NOT extended here.
SCOPE_EXPRESSIBLE = False
H5_SCOPE = None
OUTPUT_SINK_EXPRESSIBLE = False
FINDINGS = {
    "h5_scope": ("workload/grant-scope violation = requested ∉ authorized (field-vs-field non-membership). "
                 "Frozen grammar is positive-only (on:eq, a_in_b). Needs a neq/not_in DECISION or a "
                 "denylist-config oracle. Options: (A) scoped negation op; (B) denylist config; (C) ship h4+h5b."),
    "output_sink": ("sensitive output to a recipient outside the approved sink set = recipient_type ∉ approved. "
                    "Same non-membership gap as h5_scope; same decision."),
    "assurance_level": ("present-but-INSUFFICIENT assurance (e.g. sms when mfa required) = auth ≠ required "
                        "is also non-membership; Spike A models the ABSENT case (expressible via `empty`)."),
}

REFERENCE_PACK = [H4_PROVENANCE, H5B_ASSURANCE] + ([H5_SCOPE] if SCOPE_EXPRESSIBLE else [])
