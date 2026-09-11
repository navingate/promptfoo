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

# h5 scope: a workload performed a PRIVILEGED action its grant/role did NOT authorize (over-scope).
# Expressible via the scoped-negation join op `a_not_in_b` (added 2026-09-11 per the user's grammar
# decision, Option A): the workload's requested_action is NOT in its grant/role's authorized_actions.
# The component partition supplies the linkage; where_a limits A to privileged actions so a benign
# IN-scope workload (requested ∈ authorized) does not fire.
SCOPE_EXPRESSIBLE = True
H5_SCOPE = {
    "require": "all",
    "conditions": [
        {"type": "join",
         "a": {"event": "workload_run", "field": "requested_action"},
         "b": {"events": ["grant_issued", "role_assumed"], "field": "authorized_actions"},
         "on": "a_not_in_b",
         "where_a": {"field": "requested_action", "op": "in",
                     "value": {"$config": "privileged_action_names"}}}],
}
FINDINGS = {
    "output_sink": ("sensitive output to a recipient outside the approved sink set = recipient_type ∉ "
                    "approved-sinks — now expressible via a_not_in_b, but no output-sink policy/variant is "
                    "in the Spike-A corpus yet (a Spike-B addition)."),
    "assurance_level": ("present-but-INSUFFICIENT assurance (e.g. sms when mfa required) = auth ∉ "
                        "acceptable-levels — expressible via a_not_in_b, but Spike A models only the ABSENT "
                        "case (`empty`). A graded-level variant is a Spike-B addition."),
}

REFERENCE_PACK = [H4_PROVENANCE, H5B_ASSURANCE, H5_SCOPE]
