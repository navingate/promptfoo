// DeepSeek-specific excluded pilot transport; frozen F4 task code stays unchanged.
import { pacedRequest } from '../chain-cloudflare-v3/pace.mjs';

export const MODEL_ID = '@cf/deepseek-ai/deepseek-v4-pro-0813';
export const MAX_TOKENS = 16384;

export function rewriteBody(body) {
  if (body.model !== MODEL_ID || body.max_tokens !== 8192 || body.temperature !== 0) {
    throw new Error('DeepSeek pilot request drift');
  }
  return { ...body, max_tokens: MAX_TOKENS, reasoning_effort: 'low' };
}

if (process.env.F4_DEEPSEEK_PILOT === '1') {
  const endpoint = process.env.CYBER_SUT_ENDPOINT?.replace(/\/+$/u, '');
  if (
    !endpoint ||
    endpoint !== process.env.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '') ||
    process.env.CYBER_API_KEY !== process.env.CLOUDFLARE_API_KEY ||
    process.env.CYBER_MODEL !== MODEL_ID
  ) {
    throw new Error('DeepSeek pilot endpoint binding mismatch');
  }
  // biome-ignore lint/style/noRestrictedGlobals: standalone excluded pilot transport
  const originalFetch = fetch;
  const send = pacedRequest(originalFetch);
  globalThis.fetch = async (url, init) => {
    if (url !== `${endpoint}/chat/completions`) {
      throw new Error('DeepSeek pilot request path mismatch');
    }
    return await send(url, { ...init, body: JSON.stringify(rewriteBody(JSON.parse(init.body))) });
  };
}
