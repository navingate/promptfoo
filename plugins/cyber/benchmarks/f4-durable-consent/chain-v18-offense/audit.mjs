// Private hashes and request-start records around the unchanged Cloudflare v3 preload.
import crypto from 'node:crypto';
import fs from 'node:fs';

import { REQUEST_SETTINGS } from './config.mjs';

export const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function auditStart(body, startedMs, sequence) {
  const parsed = parseJsonOrNull(body);
  return {
    event: 'start',
    sequence,
    started_ms: startedMs,
    requested_model: parsed?.model ?? null,
    request_sha256: hash(body),
    request_settings: {
      max_tokens: parsed?.max_tokens ?? null,
      reasoning_effort: parsed?.reasoning_effort ?? null,
      temperature: parsed?.temperature ?? null,
      stream: parsed?.stream ?? null,
      messages_array: Array.isArray(parsed?.messages),
    },
  };
}

function auditResponse(responseText, status, sequence) {
  const parsed = parseJsonOrNull(responseText);
  const content = parsed?.choices?.[0]?.message?.content;
  return {
    event: 'response',
    sequence,
    status,
    response_sha256: hash(responseText),
    // The sidecar and final raw record are private 0600 files. Preserve the
    // full body even when the native runner omits it on an early return.
    response_body: responseText,
    served_model: parsed?.model ?? null,
    finish_reason: parsed?.choices?.[0]?.finish_reason ?? null,
    ...(typeof content === 'string' ? { content_sha256: hash(content) } : {}),
  };
}

export function combineAudit(events) {
  const starts = new Map();
  for (const event of events) {
    if (event?.event === 'start' && !starts.has(event.sequence)) {
      starts.set(event.sequence, { ...event });
    } else if (
      ['response', 'error'].includes(event?.event) &&
      starts.has(event.sequence) &&
      !starts.get(event.sequence).completed
    ) {
      Object.assign(starts.get(event.sequence), event, { completed: true });
    } else {
      throw new Error('transport audit sequence mismatch');
    }
  }
  const requests = [...starts.values()].sort((a, b) => a.sequence - b.sequence);
  if (requests.some((entry, index) => !entry.completed || entry.sequence !== index + 1)) {
    throw new Error('transport audit incomplete');
  }
  return requests.map(({ completed: _completed, event: _event, ...entry }) => entry);
}

export async function auditFetch(request, url, init, now, writeEvent, sequence) {
  const body = typeof init?.body === 'string' ? init.body : '';
  writeEvent(auditStart(body, now(), sequence));
  try {
    const response = await request(url, init);
    const responseText = await response.clone().text();
    writeEvent(auditResponse(responseText, response.status, sequence));
    return response;
  } catch (error) {
    writeEvent({
      event: 'error',
      sequence,
      error_name: typeof error?.name === 'string' ? error.name : 'transport-error',
    });
    throw error;
  }
}

// Imported before the unchanged v3 Cloudflare preload, so this fetch wrapper
// hashes the final rewritten request and returns the response body untouched.
if (process.env.F4_V18_AUDIT_PRELOAD === '1') {
  const auditFile = process.env.F4_V18_AUDIT_FILE;
  if (!auditFile) {
    throw new Error('F4 offense audit file missing');
  }
  // biome-ignore lint/style/noRestrictedGlobals: standalone native benchmark transport audit
  const originalFetch = fetch;
  let sequence = 0;
  let lastRequestStart = null;
  const writeEvent = (event) => {
    fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  };
  globalThis.fetch = async (url, init) => {
    if (lastRequestStart !== null) {
      const remaining =
        REQUEST_SETTINGS.minimum_request_start_gap_ms - (Date.now() - lastRequestStart);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    }
    lastRequestStart = Date.now();
    return await auditFetch(
      originalFetch,
      url,
      init,
      () => lastRequestStart,
      writeEvent,
      ++sequence,
    );
  };
}
