// Excluded compatibility-pilot transport shim. No estate, prompt, parser, or scorer edits.
const MODEL_ID = '@cf/zai-org/glm-5.3';
const BASE_MAX_TOKENS = 8192;
const ALLOWED_BUDGETS = [16384, 32768];

export function rewriteRequestBody(original, maxTokens, reasoningEffort) {
  if (
    original?.model !== MODEL_ID ||
    original.max_tokens !== BASE_MAX_TOKENS ||
    original.temperature !== 0 ||
    original.stream !== false ||
    !Array.isArray(original.messages) ||
    !ALLOWED_BUDGETS.includes(maxTokens) ||
    ![null, 'low'].includes(reasoningEffort)
  ) {
    throw new Error('F4 compatibility-pilot request drift');
  }
  return {
    ...original,
    max_tokens: maxTokens,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

if (process.env.F4_CF_PILOT_PRELOAD === '1') {
  const endpoint = process.env.CYBER_SUT_ENDPOINT?.replace(/\/+$/u, '');
  const apiKey = process.env.CYBER_API_KEY;
  const maxTokens = Number(process.env.F4_CF_PILOT_BUDGET);
  const reasoningEffort = process.env.F4_CF_PILOT_REASONING || null;
  if (
    !endpoint ||
    !apiKey ||
    new URL(endpoint).protocol !== 'https:' ||
    endpoint !== process.env.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '') ||
    apiKey !== process.env.CLOUDFLARE_API_KEY ||
    process.env.CYBER_MODEL !== MODEL_ID
  ) {
    throw new Error('F4 compatibility pilot needs Cloudflare HTTPS endpoint and token');
  }

  // biome-ignore lint/style/noRestrictedGlobals: a standalone, excluded pilot intentionally wraps the frozen runner transport
  const originalFetch = fetch;
  globalThis.fetch = async (input, init) => {
    if (input !== `${endpoint}/chat/completions`) {
      throw new Error('F4 compatibility-pilot endpoint drift');
    }
    const body = rewriteRequestBody(JSON.parse(init.body), maxTokens, reasoningEffort);
    return await originalFetch(input, { ...init, body: JSON.stringify(body) });
  };
}
