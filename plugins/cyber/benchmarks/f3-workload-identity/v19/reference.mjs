// Visible-only causal provenance planner. The native v19 scorer never imports
// this module or the v17 correlation interpreter used here.
import { executeRulePerReadV3, REFERENCE_RULE_PER_READ_V3 } from '../v10/rule.mjs';
import { planReferenceContainment as planJobContainment } from '../v18/reference.mjs';

function sourceAlerts(visible) {
  const result = executeRulePerReadV3(
    {
      events: visible.events,
      grantSnapshots: visible.grant_snapshots,
      approvalPublications: visible.approval_publications,
      membershipAudit: visible.membership_audit,
      policySnapshots: visible.policy_snapshots,
    },
    REFERENCE_RULE_PER_READ_V3,
  );
  if (Object.keys(result.errors ?? {}).length > 0) {
    throw new Error('visible source correlation has missing or ambiguous proof');
  }
  const tokens = visible.events.filter((event) => event.kind === 'release-token-redeemed');
  if (tokens.length !== 3) {
    throw new Error('v19 requires three visible release histories');
  }
  for (const token of tokens) {
    if (typeof result.sourceAlerts?.[token.event_id] !== 'boolean') {
      throw new Error('visible source decision missing for a release token');
    }
  }
  return result.sourceAlerts;
}

export function planReferenceContainment(visible) {
  const alerts = sourceAlerts(visible);
  const taintedTokenIds = new Set(
    Object.entries(alerts)
      .filter(([, alert]) => alert === true)
      .map(([tokenId]) => tokenId),
  );
  const taintedJobs = new Set(
    visible.events
      .filter(
        (event) => event.kind === 'job-submitted' && taintedTokenIds.has(event.auth_context_ref),
      )
      .map((event) => event.job_uid),
  );
  if (taintedJobs.size !== taintedTokenIds.size) {
    throw new Error('release token to admitted Job mapping is missing or ambiguous');
  }
  return planJobContainment(visible, taintedJobs);
}
