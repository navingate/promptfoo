-- Model-free visible-plane reference. Returns live unauthorized grant IDs to alert on.
SELECT g.grant_id AS grant_id
FROM grants AS g
JOIN remediation AS m ON m.capture_id = g.capture_id
WHERE g.principal_binding = m.compromised_user
  AND EXISTS (
    SELECT 1
    FROM events AS call
    JOIN events AS token
      ON token.capture_id = call.capture_id
     AND token.event_id = call.caused_by_event_id
    WHERE call.capture_id = g.capture_id
      AND call.grant_id = g.grant_id
      AND call.kind = 'protected-export-call'
      AND call.resource = :protected_scope
      AND call.time > m.reset_time
      AND call.credential_lineage = g.refresh_lineage
      AND token.kind = 'access-token-issued'
      AND token.grant_id = g.grant_id
      AND token.credential_lineage = g.refresh_lineage
  )
  AND NOT EXISTS (
    SELECT 1 FROM revoked_grants AS rv
    WHERE rv.capture_id = g.capture_id AND rv.grant_id = g.grant_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM base_policy AS b
    WHERE b.capture_id = g.capture_id
      AND b.grantor_type = g.grantor_type
      AND b.approval_route = g.approval_route
      AND b.verification_state = g.verification_state
      AND (
        b.scopes_within_catalog = 0
        OR NOT EXISTS (
          SELECT 1 FROM json_each(g.scopes_json) AS requested
          WHERE NOT EXISTS (
            SELECT 1 FROM json_each(g.catalog_scopes_json) AS catalog
            WHERE catalog.value = requested.value
          )
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM registry AS r
    WHERE r.capture_id = g.capture_id
      AND r.valid_from <= g.issue_time
      AND (r.valid_until IS NULL OR r.valid_until >= g.issue_time)
      AND (r.revoked_at IS NULL OR r.revoked_at > g.issue_time)
      AND EXISTS (SELECT 1 FROM json_each(r.client_or_app_selector) AS s WHERE s.value = '*' OR s.value = g.client_id)
      AND EXISTS (SELECT 1 FROM json_each(r.tenant_selector) AS s WHERE s.value = '*' OR s.value = g.tenant)
      AND EXISTS (SELECT 1 FROM json_each(r.principal_selector) AS s WHERE s.value = '*' OR s.value = g.principal_binding)
      AND EXISTS (SELECT 1 FROM json_each(r.approval_route_selector) AS s WHERE s.value = '*' OR s.value = g.approval_route)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(g.scopes_json) AS requested
        WHERE NOT EXISTS (
          SELECT 1 FROM json_each(r.scope_selector) AS allowed
          WHERE allowed.value = '*' OR allowed.value = requested.value
        )
      )
  );
