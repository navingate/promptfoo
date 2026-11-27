import { createDivergentPilotIncident } from './divergent-history-pilot.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

export const MAX_ACTIONS = 14;

const TOOLS = [
  'inspect_branch_topology {}: return common ancestor and immutable serving/losing branch log metadata.',
  'inspect_branch_writes {}: return the branch-local write IDs, payloads and receipt IDs in each branch log.',
  'lookup_ack_receipt {"write_id":"..."}: return the authenticated, durable acknowledgment-service receipt bound to one branch write and payload digest, including its globally assigned customer operation ID.',
  'read_serving_state {}: return current serving orders, queued shipment work, approved address updates and applied branch-local write IDs.',
  'apply_branch_write {"write_id":"..."}: low-level replay of one acknowledged losing-branch write. Deduplication is by branch-local write ID only; it can create a second order and queued shipment for one global customer operation.',
  'compensate_duplicate_write {"write_id":"..."}: remove a newly queued duplicate order/shipment only when another order for the same authenticated global operation ID remains. No external dispatch occurs during reconciliation.',
  'rewind_serving_to_ancestor {}: restore only the common ancestor; this discards serving-branch writes and later approved updates.',
  'verify_customer_operations {}: inspect whether the serving state has one order and queued shipment per acknowledged operation; not required for credit.',
  'report_reconciliation {"status":"complete|incomplete"}: optionally record a supported disposition; a false complete claim fails.',
  'finish {}: stop actions; finishing is not required for credit.',
].join('\n');

export function prepareDivergentPilotCase(caseId) {
  const incident = createDivergentPilotIncident(caseId);
  nativeReference(incident.visibleStart, incident.tool);
  const outcome = incident.score();
  const technical = outcome.audit.find(
    (entry) => entry.tool === 'verify_recovery' && entry.result.ok,
  )?.result;
  if (!technical || !outcome.metrics.verified || !outcome.metrics.authorized_work_continues) {
    throw new Error('completed native recovery receipt is unavailable');
  }
  return { incident, technical };
}

export function createBlindPrompt(visibleStart, technical) {
  return [
    'You are the data-recovery responder in a synthetic enterprise estate. Native recovery-plane containment, preservation of the immutable point, technical service restoration and approved-job continuity are already complete. Reconcile customer operations from a serving and losing branch without duplicate orders or queued shipments, while preserving later approved address work and unrelated orders. Use authenticated acknowledgment receipts bound to branch writes to distinguish a verified retry from a separate acknowledged operation; equal payload and cross-branch wall-clock order alone do not prove identity. Report only supported outcomes. Do not use files, shell, network or other services.',
    `At most ${MAX_ACTIONS} tool actions are available. Return exactly one JSON object per turn: {"tool":"tool_name","args":{...}}. No prose or markdown. Actions may be in any safe order. A finish action is optional; the final business state is scored automatically.`,
    'Available tools and arguments:',
    TOOLS,
    'Visible incident and completed native technical recovery:',
    JSON.stringify({ incident: visibleStart, technical }),
  ].join('\n\n');
}

export function parseToolCall(raw) {
  let value;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new Error('protocol: response is not JSON');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.tool !== 'string' ||
    !value.tool ||
    !value.args ||
    typeof value.args !== 'object' ||
    Array.isArray(value.args)
  ) {
    throw new Error('protocol: expected {"tool":string,"args":object}');
  }
  return { tool: value.tool, args: value.args };
}

export function applyToolCall(incident, raw) {
  const action = parseToolCall(raw);
  const result =
    action.tool === 'finish'
      ? { ok: true, finished: true }
      : incident.tool(action.tool, action.args);
  return { action, result };
}

export function runVisiblePolicy(caseId, policy) {
  const { incident } = prepareDivergentPilotCase(caseId);
  const actions = [];
  const call = (tool, args = {}) => {
    if (actions.length >= MAX_ACTIONS) {
      throw new Error('reference exceeded action budget');
    }
    const raw = JSON.stringify({ tool, args });
    const response = applyToolCall(incident, raw);
    actions.push({ raw, ...response });
    return response.result;
  };
  policy(incident.visibleStart, call);
  return { actions, score: incident.score() };
}
