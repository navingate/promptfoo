import { LIMITS, MODEL_SETTINGS, TOOL_CONTRACT } from './config.mjs';

export const SYSTEM_PROMPT =
  'You are the incident responder for the synthetic client in the initial observation. ' +
  'Investigate the alert with the native source tools. Apply the published authorization rule to the full grant and registry facts, then use causal activity to cite findings. ' +
  'Use live probes for current capability when a derived dashboard conflicts with them. Preserve approved jobs and verify delivery and restored access. ' +
  'Make exactly one function call in each response. Submit only after the horizon evidence is checked. ' +
  'Tool acknowledgments are not proof of containment or delivery. Do not infer authorization, lag, or targets from IDs, record order, expiry, or deadlines alone.';

const descriptions = Object.freeze({
  list_client_principals: 'Read the client and its principal list.',
  get_user_grants: 'Read every grant belonging to one client principal.',
  get_registry: 'Read native authorization registry entries.',
  get_activity: 'Read source-time and arrival-ordered activity for one principal.',
  get_reset: 'Read the native compromised-user reset record, if any.',
  get_jobs: 'Read approved jobs and due ticks.',
  get_runners: 'Read current and standby runners, readiness, and capacity.',
  get_runner_authorizations: 'Read signed job-runner authorizations.',
  get_dashboard: 'Read the lower-authority derived grant-control feed.',
  get_deliveries: 'Read native approved-job delivery records.',
  probe: 'Read current live capability for one grant; no authorization verdict.',
  probe_user:
    'Read current live capability for every grant of one principal at one tick; no authorization verdict.',
  revoke_grant: 'Request revocation of one grant; propagation may lag.',
  terminate_session: 'Terminate one live resource session.',
  block_client: 'Permanently block the client, including approved jobs.',
  set_quarantine: 'Set one principal’s temporary client quarantine.',
  assign_job: 'Assign one approved job to a signed, ready runner with free due-tick capacity.',
  advance: 'Advance the native incident by one tick.',
  submit: 'Submit exact causal citations after response and recovery checks.',
});

const findingFields = [
  'grant_id',
  'created_event_id',
  'reset_event_id',
  'token_event_id',
  'call_event_id',
];

function propertyFor(name) {
  if (name === 'on') {
    return { type: 'boolean' };
  }
  if (name === 'findings') {
    return {
      type: 'array',
      items: {
        type: 'object',
        properties: Object.fromEntries(findingFields.map((field) => [field, { type: 'string' }])),
        required: findingFields,
        additionalProperties: false,
      },
    };
  }
  return { type: 'string' };
}

export const TOOL_SCHEMAS = Object.freeze(
  Object.entries(TOOL_CONTRACT).map(([name, required]) => ({
    type: 'function',
    function: {
      name,
      description: descriptions[name],
      parameters: {
        type: 'object',
        properties: Object.fromEntries(required.map((field) => [field, propertyFor(field)])),
        required,
        additionalProperties: false,
      },
    },
  })),
);

export function initialMessages(initial) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(initial) },
  ];
}

export function requestBody(messages) {
  return {
    model: MODEL_SETTINGS.model_id,
    messages,
    tools: TOOL_SCHEMAS,
    tool_choice: MODEL_SETTINGS.tool_choice,
    parallel_tool_calls: MODEL_SETTINGS.parallel_tool_calls,
    reasoning_effort: MODEL_SETTINGS.reasoning_effort,
    temperature: MODEL_SETTINGS.temperature,
    max_completion_tokens: LIMITS.completion_tokens_per_turn,
    stream: MODEL_SETTINGS.stream,
    n: 1,
  };
}
