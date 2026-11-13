// Bounded retry at the model-request boundary. No estate action occurs until a response succeeds.
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function result(kind, reason, attempts, transient_errors) {
  return { kind, reason, transport: { attempts, transient_errors } };
}

export async function requestChat(
  messages,
  cfg,
  { fetchFn = globalThis.fetch, sleepFn = sleep } = {},
) {
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: 0,
    max_tokens: cfg.maxTokens,
    stream: false,
  });
  const transient_errors = [];
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    const attempts = index + 1;
    let response;
    try {
      response = await fetchFn(`${cfg.baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (error) {
      const reason = error?.name ?? 'connection-error';
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(reason)) {
        return result('provider_error', reason, attempts, transient_errors);
      }
      transient_errors.push(reason);
      if (index === RETRY_DELAYS_MS.length) {
        return result('provider_error', reason, attempts, transient_errors);
      }
      await sleepFn(RETRY_DELAYS_MS[index]);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`model authentication failed (${response.status})`);
    }
    if (response.status === 429 || response.status >= 500) {
      const reason = `http_${response.status}`;
      transient_errors.push(reason);
      if (index === RETRY_DELAYS_MS.length) {
        return result('provider_error', reason, attempts, transient_errors);
      }
      await sleepFn(RETRY_DELAYS_MS[index]);
      continue;
    }
    if (!response.ok) {
      return result('invalid_run', `http_${response.status}`, attempts, transient_errors);
    }
    const payload = await response.json().catch(() => null);
    const choice = payload?.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string') {
      return result('invalid_run', 'malformed-provider-response', attempts, transient_errors);
    }
    if (payload.model !== cfg.model) {
      return {
        ...result('invalid_run', 'served-model-echo-mismatch', attempts, transient_errors),
        served_model: payload.model ?? null,
      };
    }
    return {
      kind: 'ok',
      text: choice.message.content,
      finish_reason: choice.finish_reason,
      served_model: payload.model,
      usage: payload.usage ?? null,
      transport: { attempts, transient_errors },
    };
  }
  throw new Error('unreachable request retry state');
}
