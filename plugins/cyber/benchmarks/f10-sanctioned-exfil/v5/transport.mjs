// Bounded retry at the model-request boundary. No estate action occurs until a response succeeds.
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000];
export const REQUEST_WALL_MS = 300000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function result(kind, reason, attempts, transient_errors) {
  return { kind, reason, transport: { attempts, transient_errors } };
}

async function waitAfterTransient(index, reason, deadlineMs, wallReason, nowFn, sleepFn, errors) {
  errors.push(reason);
  if (index === RETRY_DELAYS_MS.length) {
    return result('provider_error', reason, index + 1, errors);
  }
  const delayMs = RETRY_DELAYS_MS[index];
  if (delayMs >= deadlineMs - nowFn()) {
    return result('provider_error', wallReason, index + 1, errors);
  }
  await sleepFn(delayMs);
  return null;
}

async function parseHttpResponse(response, cfg, attempts, transient_errors) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(`model authentication failed (${response.status})`);
  }
  if (response.status === 429 || response.status >= 500) {
    return { kind: 'transient', reason: `http_${response.status}` };
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

export async function requestChat(
  messages,
  cfg,
  { fetchFn = globalThis.fetch, sleepFn = sleep, nowFn = Date.now } = {},
) {
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: 0,
    max_tokens: cfg.maxTokens,
    stream: false,
  });
  const transient_errors = [];
  const requestDeadlineMs = nowFn() + REQUEST_WALL_MS;
  const screenDeadlineMs = cfg.screenDeadlineMs ?? Infinity;
  const deadlineMs = Math.min(requestDeadlineMs, screenDeadlineMs);
  const wallReason =
    screenDeadlineMs <= requestDeadlineMs ? 'screen-wall-limit' : 'request-wall-limit';
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    const attempts = index + 1;
    const remainingMs = deadlineMs - nowFn();
    if (remainingMs <= 0) {
      return result('provider_error', wallReason, index, transient_errors);
    }
    let response;
    try {
      response = await fetchFn(`${cfg.baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(cfg.timeoutMs, remainingMs)))),
      });
    } catch (error) {
      const reason = error?.name ?? 'connection-error';
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(reason)) {
        return result('provider_error', reason, attempts, transient_errors);
      }
      const terminal = await waitAfterTransient(
        index,
        reason,
        deadlineMs,
        wallReason,
        nowFn,
        sleepFn,
        transient_errors,
      );
      if (terminal) {
        return terminal;
      }
      continue;
    }
    const parsed = await parseHttpResponse(response, cfg, attempts, transient_errors);
    if (parsed.kind !== 'transient') {
      return parsed;
    }
    const terminal = await waitAfterTransient(
      index,
      parsed.reason,
      deadlineMs,
      wallReason,
      nowFn,
      sleepFn,
      transient_errors,
    );
    if (terminal) {
      return terminal;
    }
  }
  throw new Error('unreachable request retry state');
}
