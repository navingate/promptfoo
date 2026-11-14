import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

// Matches F10's bounded request-boundary retry schedule. The F9 estate is not replayed.
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000, 8000, 16000, 32000]);
export const MIN_REQUEST_GAP_MS = 5000;
export const REQUEST_WALL_MS = 300000;

export function createRetryingPacedFetch(
  fetchImpl,
  {
    minGapMs = MIN_REQUEST_GAP_MS,
    retryDelaysMs = RETRY_DELAYS_MS,
    requestWallMs = REQUEST_WALL_MS,
    attemptTimeoutMs = 300000,
    monotonicNow = () => performance.now(),
    wallNow = Date.now,
    sleep = delay,
    getSlot = () => null,
    onUpdate = () => {},
  } = {},
) {
  if (!Number.isFinite(minGapMs) || minGapMs < MIN_REQUEST_GAP_MS) {
    throw new Error('request start gap must be at least 5000 ms');
  }
  if (
    !Number.isFinite(requestWallMs) ||
    requestWallMs <= 0 ||
    !Number.isFinite(attemptTimeoutMs) ||
    attemptTimeoutMs <= 0 ||
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.some((ms) => !Number.isFinite(ms) || ms < 0)
  ) {
    throw new Error('invalid retry budget');
  }
  let nextStart = -Infinity;
  const starts = [];
  const requests = [];

  const fetch = async (url, options) => {
    const record = {
      logical_request_index: requests.length + 1,
      slot: getSlot(),
      attempts: 0,
      transient_errors: [],
      outcome: 'running',
    };
    requests.push(record);
    onUpdate();
    const deadline = wallNow() + requestWallMs;
    for (let index = 0; index <= retryDelaysMs.length; index += 1) {
      while (monotonicNow() < nextStart) {
        await sleep(nextStart - monotonicNow());
      }
      const remaining = deadline - wallNow();
      if (remaining <= 0) {
        record.outcome = 'request-wall-limit';
        onUpdate();
        throw new Error('request wall limit');
      }
      const started = monotonicNow();
      nextStart = started + minGapMs;
      record.attempts += 1;
      starts.push({
        logical_request_index: record.logical_request_index,
        slot: record.slot,
        attempt: record.attempts,
        monotonic_ms: started,
        epoch_ms: wallNow(),
      });
      onUpdate();
      let response;
      try {
        const timeout = AbortSignal.timeout(
          Math.max(1, Math.floor(Math.min(attemptTimeoutMs, remaining))),
        );
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        response = await fetchImpl(url, { ...options, signal });
      } catch (cause) {
        if (cause?.name !== 'TypeError') {
          record.outcome = `error-${cause?.name ?? 'unknown'}`;
          onUpdate();
          throw cause;
        }
        const backoff = retryDelaysMs[index] ?? null;
        record.transient_errors.push({
          attempt: record.attempts,
          reason: 'TypeError',
          backoff_ms: backoff,
        });
        if (backoff === null) {
          record.outcome = 'exhausted-TypeError';
          onUpdate();
          throw cause;
        }
        if (backoff >= deadline - wallNow()) {
          record.outcome = 'request-wall-limit';
          onUpdate();
          throw new Error('request wall limit');
        }
        onUpdate();
        await sleep(backoff);
        continue;
      }
      if (response.status !== 429) {
        record.outcome = response.ok ? 'ok' : `http-${response.status}`;
        onUpdate();
        return response;
      }
      const backoff = retryDelaysMs[index] ?? null;
      record.transient_errors.push({
        attempt: record.attempts,
        reason: 'http-429',
        backoff_ms: backoff,
      });
      if (backoff === null) {
        record.outcome = 'exhausted-http-429';
        onUpdate();
        return response;
      }
      if (backoff >= deadline - wallNow()) {
        record.outcome = 'request-wall-limit';
        onUpdate();
        return response;
      }
      onUpdate();
      await sleep(backoff);
    }
    throw new Error('unreachable retry state');
  };
  return { fetch, starts, requests };
}
