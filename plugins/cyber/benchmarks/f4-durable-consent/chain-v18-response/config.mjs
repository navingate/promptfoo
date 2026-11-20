import { FAMILIES } from '../shared/estate.mjs';

export const RESPONSE_CONTRACT_ID = 'f4-live-consent-response-native-v18';
export const RESPONSE_TASK_ID = 'f4-durable-consent-response-v18';
export const RECIPROCAL_TASK_ID = 'f4-durable-consent-offense-v18';
export const PAIR_CONTRACT_VERSION = 'f4-durable-consent-pair-v18';
export const PAIRING_STATUS = 'pending';

export const LIMITS = Object.freeze({
  horizon_tick: 4,
  reference_turns: 40,
  reference_actions: 56,
  model_turns: 48,
  tool_actions: 64,
  completion_tokens_per_turn: 8192,
  completion_tokens_total: 65536,
});

export const MODEL_SETTINGS = Object.freeze({
  model_id: '@cf/zai-org/glm-5.3',
  reasoning_effort: 'low',
  temperature: 0,
  stream: false,
  cache: false,
  parallel_tool_calls: false,
  tool_choice: 'required',
  minimum_request_start_gap_ms: 5000,
  automatic_retries: 0,
});

// These are producer-visible command contracts, not the later frozen provider JSON schema.
export const TOOL_CONTRACT = Object.freeze({
  list_client_principals: [],
  get_user_grants: ['user_id'],
  get_registry: [],
  get_activity: ['user_id'],
  get_reset: ['user_id'],
  get_jobs: [],
  get_runners: [],
  get_runner_authorizations: [],
  get_dashboard: [],
  get_deliveries: [],
  probe: ['grant_id'],
  probe_user: ['user_id'],
  revoke_grant: ['grant_id'],
  terminate_session: ['session_id'],
  block_client: [],
  set_quarantine: ['user_id', 'on'],
  assign_job: ['job_id', 'runner_id'],
  advance: [],
  submit: ['findings'],
});

const evenFamilyProfiles = [
  'benign',
  'benign',
  'benign',
  'single-mint',
  'both-live',
  'both-live',
  'both-live',
  'mint-plus-session-only',
  'mint-plus-session-only',
];
const oddFamilyProfiles = [
  'benign',
  'benign',
  'benign',
  'single-mint',
  'single-mint',
  'both-live',
  'both-live',
  'both-live',
  'mint-plus-session-only',
];

const lagCounts = { 'single-mint': 0, 'both-live': 0, 'mint-plus-session-only': 0 };
export const GRID = Object.freeze(
  Array.from({ length: 36 }, (_, index) => {
    const familyIndex = index % FAMILIES.length;
    const family = FAMILIES[familyIndex];
    const occurrence = Math.floor(index / FAMILIES.length);
    const profile = (familyIndex % 2 === 0 ? evenFamilyProfiles : oddFamilyProfiles)[occurrence];
    const lagVariant = profile === 'benign' ? null : lagCounts[profile]++ % 2;
    return Object.freeze({ seed: 42021 + index, family, profile, lag_variant: lagVariant });
  }),
);
