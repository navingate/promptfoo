// Read-only SQL view of validated native F4 captures. Never includes the evaluator key.
import { validateNativeBatch } from '../chain-v4/capture.mjs';

const json = (value) => JSON.stringify(value);

export function projectBatch(batch) {
  const validation = validateNativeBatch(batch);
  if (!validation.ok) {
    throw new Error(`invalid native batch: ${validation.reason}`);
  }
  const tables = {
    grants: [],
    events: [],
    registry: [],
    base_policy: [],
    remediation: [],
    revoked_grants: [],
  };
  for (const capture of batch.captures) {
    const { capture_id: captureId, grant, remediation } = capture;
    tables.grants.push({
      capture_id: captureId,
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      tenant: grant.tenant,
      principal_binding: grant.principal_binding,
      scopes_json: json(grant.scopes),
      catalog_scopes_json: json(grant.catalog_scopes),
      approval_route: grant.approval_route,
      grantor_type: grant.grantor_type,
      verification_state: grant.verification_state,
      issue_time: grant.issue_time,
      refresh_lineage: grant.refresh_lineage,
    });
    for (const event of capture.events) {
      tables.events.push({
        capture_id: captureId,
        event_id: event.event_id,
        caused_by_event_id: event.caused_by_event_id,
        grant_id: event.grant_id ?? null,
        kind: event.kind,
        time: event.time,
        resource: event.resource ?? null,
        credential_lineage: event.credential_lineage ?? null,
        export_ref: event.export_ref ?? null,
      });
    }
    for (const row of capture.registry) {
      tables.registry.push({
        capture_id: captureId,
        policy_entry_id: row.policy_entry_id,
        client_or_app_selector: json(row.client_or_app_selector),
        tenant_selector: json(row.tenant_selector),
        principal_selector: json(row.principal_selector),
        scope_selector: json(row.scope_selector),
        approval_route_selector: json(row.approval_route_selector),
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        revoked_at: row.revoked_at,
      });
    }
    for (const rule of capture.base_policy.rules) {
      tables.base_policy.push({
        capture_id: captureId,
        grantor_type: rule.grantor_type,
        approval_route: rule.approval_route,
        verification_state: rule.verification_state,
        scopes_within_catalog: Number(rule.scopes_within_catalog === true),
      });
    }
    tables.remediation.push({
      capture_id: captureId,
      reset_time: remediation.reset_time,
      compromised_user: remediation.compromised_user,
    });
    for (const grantId of remediation.revoked_grant_ids) {
      tables.revoked_grants.push({ capture_id: captureId, grant_id: grantId });
    }
  }
  return tables;
}
