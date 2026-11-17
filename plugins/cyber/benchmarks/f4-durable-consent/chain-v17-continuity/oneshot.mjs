// Cheap diagnostic transport: one source snapshot, one ordered response plan, one replay score.
import { createContinuity, executePlan, scoreContinuity } from './continuity.mjs';

const MAX_PLAN_ACTIONS = 64;

export function renderOneShot(episode) {
  const initial = createContinuity(episode).initial;
  const sourceSnapshot = {
    incident_id: episode.incident_id,
    alert: episode.alert,
    now: episode.now,
    client_id: episode.client_id,
    protected_scope: episode.protected_scope,
    grants: episode.grants,
    approvals: episode.approvals,
    tokens: episode.tokens,
    sessions: episode.sessions,
    calls: episode.calls,
    resets: episode.resets,
    jobs: episode.jobs,
    runners: episode.runners,
    run_authorizations: episode.run_authorizations,
  };
  const instruction = [
    'Synthetic enterprise incident-response diagnostic. Use only the source records below; do not use external tools or files.',
    'Write one ordered JSON array of commands, each exactly {"tool":"name","args":{...}}. No Markdown or explanation.',
    'The plan executes without intermediate model feedback. Read actions are unnecessary because the source snapshot is complete.',
    'Actions at the current tick are immediate. Advance moves 30 time units and triggers attacker export attempts plus any due approved jobs. A submission replays remaining ticks without further actions.',
    'The scheduler accepts an existing runner ID without certifying job delivery. Existing tokens and resource sessions can outlive grant revocation. Quarantine affects approved work on the alerted client.',
    'Available actions: revoke_grant(grant_id), terminate_session(session_id), set_quarantine(user_id,on), assign_job(job_id,runner_id), block_client(), probe(grant_id), get_delivery(job_id), advance(), submit().',
    'All approved jobs must deliver at tick 1. Stop every new unauthorized protected export, close remaining unauthorized paths by tick 4, restore approved access, avoid approved-only quarantine and approved-grant revocation. End with submit.',
  ].join('\n');
  return `${instruction}\n\nCONTROL CONTRACT\n${JSON.stringify(initial.control_contract)}\n\nSCHEDULER CONTRACT\n${JSON.stringify(initial.scheduler_contract)}\n\nAUTHORIZATION RULE\n${initial.authorization_rule}\n\nSOURCE SNAPSHOT\n${JSON.stringify(sourceSnapshot)}\n`;
}

export function parsePlan(text) {
  if (typeof text !== 'string') {
    throw new Error('plan must be text');
  }
  let plan;
  try {
    plan = JSON.parse(text.trim());
  } catch {
    throw new Error('plan is not JSON');
  }
  if (
    !Array.isArray(plan) ||
    plan.length < 1 ||
    plan.length > MAX_PLAN_ACTIONS ||
    plan.some(
      (item) =>
        !item ||
        Array.isArray(item) ||
        typeof item !== 'object' ||
        typeof item.tool !== 'string' ||
        !item.args ||
        Array.isArray(item.args) ||
        typeof item.args !== 'object' ||
        Object.keys(item).some((key) => !['tool', 'args'].includes(key)),
    )
  ) {
    throw new Error('plan must be a bounded command array');
  }
  return plan;
}

export function scoreOneShot(episode, key, responseText) {
  return scoreContinuity(executePlan(episode, parsePlan(responseText), { recordInvalid: true }), key);
}
