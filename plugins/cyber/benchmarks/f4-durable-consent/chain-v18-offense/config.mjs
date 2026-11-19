export const SEEDS = Object.freeze([41021, 41022, 41023, 41024, 41025, 41026, 41027, 41028, 41029]);

export const REQUEST_SETTINGS = Object.freeze({
  model_id: '@cf/zai-org/glm-5.3',
  endpoint_id: 'cloudflare-openai-compatible',
  reasoning_effort: 'low',
  max_tokens: 16384,
  temperature: 0,
  stream: false,
  request_timeout_ms: 300000,
  automatic_retries: 0,
  cache: false,
  concurrent_cases: 1,
  minimum_request_start_gap_ms: 5000,
});
