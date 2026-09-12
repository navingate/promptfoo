"""Spike-A telemetry schema for v2 multi-hop detection. References + metadata only — NO tokens,
ciphertext, keys, or derived conclusions. Config is FLAT neutral inventories (the frozen grammar's
$config resolves a flat scalar/list only). Edges are UNIQUE TRANSACTIONAL references only."""

EVENT_TYPES = {
    "assertion_issued", "session_created", "session_tag_applied",
    "role_assumed", "grant_issued", "workload_run",
    "stepup_minted", "vault_access", "kms_unwrap", "workload_output_returned",
}

# §8 edge table: (typeA, fieldA) links to (typeB, fieldB) when the ref VALUES are equal & non-null.
# NOTE: the design-review §8 table listed 8 edges but omitted session->tag, workload->kms_unwrap and
# workload->output, which orphans those events into their own components. Completed here to 11 edges so
# every back-half event joins its chain (still only UNIQUE TRANSACTIONAL refs; no stable-id edges).
EDGE_TABLE = [
    ("assertion_issued", "assertion_ref", "session_created", "from_assertion_ref"),
    ("session_created", "session_ref", "session_tag_applied", "session_ref"),
    ("session_created", "session_ref", "role_assumed", "via_session_ref"),
    ("session_created", "session_ref", "grant_issued", "via_session_ref"),
    ("role_assumed", "role_session_ref", "workload_run", "via_role_session_ref"),
    ("grant_issued", "grant_ref", "workload_run", "via_grant_ref"),
    ("session_created", "session_ref", "stepup_minted", "from_session_ref"),
    ("workload_run", "workload_ref", "vault_access", "workload_ref"),
    ("workload_run", "workload_ref", "kms_unwrap", "workload_ref"),
    ("workload_run", "workload_ref", "workload_output_returned", "workload_ref"),
    ("stepup_minted", "auth_context_ref", "kms_unwrap", "auth_context_ref"),
]

# fields that look joinable but MUST NOT form edges (shared across unrelated activity)
NON_EDGE_FIELDS = {"execution_principal", "user_principal", "requested_action",
                   "requested_resource_ref", "tag_name", "role_id", "resource_id"}

# flat SOC config (the $config inventories). Decoys in entitlement_tag_names are OTHER real
# sensitive entitlements (exercised authoritatively in the corpus), not harmless noise.
INVENTORIES = {
    "self_service_attribute_names": ["extensionAttribute7", "costCenter", "orgUnit"],
    "entitlement_tag_names": ["provision-scope", "deploy-eligibility", "break-glass"],
    "protected_resource_ids": ["tenant-vault/secret-blob"],
    "privileged_action_names": ["read-vault", "kms-unwrap"],
    "required_assurance_for_unwrap": "mfa",   # policy: unwrap needs an mfa-backed step-up
}

_REQUIRED = {"event", "batch_id"}


def validate_event(e):
    if not isinstance(e, dict):
        raise ValueError("event must be a dict")
    if e.get("event") not in EVENT_TYPES:
        raise ValueError(f"unknown event type: {e.get('event')!r}")
    for k in _REQUIRED:
        if not e.get(k):
            raise ValueError(f"event missing required field {k!r}")
