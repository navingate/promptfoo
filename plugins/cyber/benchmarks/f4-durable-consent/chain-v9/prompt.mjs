import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEVELOPMENT = JSON.parse(fs.readFileSync(path.join(here, 'development.json'), 'utf8'));

export const SYSTEM_PROMPT = `You are writing one incident-detection rule for a read-only SQLite estate. Return exactly one SQL SELECT statement, with one output column named grant_id. No Markdown, explanation, literal grant/client/capture IDs, second statement, or side effects. Use :protected_scope for the protected resource. The statement will be frozen and run unchanged on other estates.

Detect surviving unauthorized delegated grants that made a protected call after remediation. Correlate grant, token, and protected-call events by capture, grant, credential lineage, event causality, and time. A revoked grant is contained. A grant is authorized if a matching published base_policy rule applies or ONE registry row covers the client, tenant, principal, every requested scope, approval route, and grant issue time. Do not combine selector matches across different registry rows.

Schema (JSON fields contain JSON text):
grants(capture_id, grant_id, client_id, tenant, principal_binding, scopes_json, catalog_scopes_json, approval_route, grantor_type, verification_state, issue_time, refresh_lineage)
events(capture_id, event_id, caused_by_event_id, grant_id, kind, time, resource, credential_lineage, export_ref)
registry(capture_id, policy_entry_id, client_or_app_selector, tenant_selector, principal_selector, scope_selector, approval_route_selector, valid_from, valid_until, revoked_at)
base_policy(capture_id, grantor_type, approval_route, verification_state, scopes_within_catalog)
remediation(capture_id, reset_time, compromised_user)
revoked_grants(capture_id, grant_id)

Registry selector grammar: each selector is JSON. A JSON string matches exactly; a JSON array matches by membership; explicit JSON string "*" is a wildcard. A missing or null selector does not match. The scope selector must cover every scope requested by the grant. A registry row is valid at issue_time when valid_from <= issue_time, valid_until is null or >= issue_time, and revoked_at is null or > issue_time. Base-policy scopes_within_catalog requires every requested scope to appear in catalog_scopes_json. Ordinary SQLite SELECT, CTEs, joins, EXISTS, and JSON functions are available. Query only the six published tables.`;

export function modelMessages() {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Here is a small independent development estate. It has no evaluator labels. Author the SQL rule.\n${JSON.stringify(DEVELOPMENT.tables)}`,
    },
  ];
}
