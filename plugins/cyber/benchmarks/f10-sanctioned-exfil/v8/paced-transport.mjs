// Request-start pacing only. The frozen v5 transport still owns retries and provider parsing.
import { performance } from 'node:perf_hooks';

import { requestChat } from '../v5/transport.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const MIN_REQUEST_GAP_MS = 5000;

export function makePacedRequest({
  fetchFn = globalThis.fetch,
  sleepFn = sleep,
  monotonicNow = () => performance.now(),
  wallNow = Date.now,
  minGapMs = MIN_REQUEST_GAP_MS,
  reasoningEffort = null,
  onResponse = () => {},
  getSlot = () => null,
} = {}) {
  if (!Number.isInteger(minGapMs) || minGapMs < MIN_REQUEST_GAP_MS) {
    throw new Error('Cloudflare request gap must be at least 5000 ms');
  }
  if (reasoningEffort !== null && reasoningEffort !== 'low') {
    throw new Error('only the separately declared low-reasoning diagnostic is supported');
  }
  let nextStart = -Infinity;
  const starts = [];
  const responses = [];
  const pacedFetch = async (url, init) => {
    while (monotonicNow() < nextStart) {
      await sleepFn(nextStart - monotonicNow());
    }
    const started = monotonicNow();
    nextStart = started + minGapMs;
    starts.push({ slot: getSlot(), monotonic_ms: started, epoch_ms: wallNow() });
    const request = reasoningEffort
      ? {
          ...init,
          body: JSON.stringify({ ...JSON.parse(init.body), reasoning_effort: reasoningEffort }),
        }
      : init;
    return fetchFn(url, request);
  };
  return {
    starts,
    responses,
    request: async (messages, cfg) => {
      let response;
      try {
        response = await requestChat(messages, cfg, {
          fetchFn: pacedFetch,
          sleepFn,
          nowFn: wallNow,
        });
      } catch (error) {
        responses.push({
          slot: getSlot(),
          kind: 'thrown',
          reason: error?.message ?? String(error),
        });
        onResponse();
        throw error;
      }
      responses.push({
        slot: getSlot(),
        kind: response.kind,
        reason: response.reason,
        finish_reason: response.finish_reason,
        served_model: response.served_model,
        usage: response.usage,
        transport: response.transport,
      });
      onResponse();
      return response;
    },
  };
}
