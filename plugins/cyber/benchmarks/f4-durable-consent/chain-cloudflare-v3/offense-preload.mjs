// Paced low16 transport for the frozen v3 offense runner.
import { rewriteRequestBody } from '../chain-cloudflare-v2/transport-preload.mjs';
import { pacedRequest } from './pace.mjs';

if (process.env.F4_CF_SCORE_PRELOAD === '1') {
  const endpoint = process.env.CYBER_SUT_ENDPOINT?.replace(/\/+$/u, '');
  if (
    !endpoint ||
    endpoint !== process.env.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '') ||
    process.env.CYBER_API_KEY !== process.env.CLOUDFLARE_API_KEY ||
    process.env.CYBER_MODEL !== '@cf/zai-org/glm-5.3'
  ) {
    throw new Error('F4 scored Cloudflare endpoint binding mismatch');
  }
  // biome-ignore lint/style/noRestrictedGlobals: standalone benchmark transport adapter
  const originalFetch = fetch;
  const send = pacedRequest(originalFetch);
  globalThis.fetch = async (url, init) => {
    if (url !== `${endpoint}/chat/completions`) {
      throw new Error('F4 scored Cloudflare request path mismatch');
    }
    const body = rewriteRequestBody(JSON.parse(init.body), 16384, 'low');
    return await send(url, { ...init, body: JSON.stringify(body) });
  };
}
