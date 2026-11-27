#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const publisherPath = process.argv[2];
if (!publisherPath) {
  throw new Error('publisher-path-required');
}
let input = '';
function readLine() {
  const buffer = Buffer.allocUnsafe(4096);
  while (!input.includes('\n')) {
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) {
      throw new Error('recipient-broker-closed');
    }
    input += buffer.toString('utf8', 0, count);
  }
  const end = input.indexOf('\n');
  const line = input.slice(0, end);
  input = input.slice(end + 1);
  return line;
}
const secretHex = readLine();
if (!/^[a-f0-9]{64}$/.test(secretHex)) {
  throw new Error('recipient-broker-authentication-missing');
}
const secret = Buffer.from(secretHex, 'hex');
const createHmac = crypto.createHmac;
const stringify = JSON.stringify;
function authenticatedLine(payload) {
  const tag = createHmac('sha256', secret).update(stringify(payload)).digest('hex');
  return `${stringify({ ...payload, tag })}\n`;
}
let messageId = 0;
function deliver(origin, path, method, headers, body) {
  const id = ++messageId;
  const payload = { rpc: 'f10-v41-recipient', id, origin, path, method, headers, body };
  fs.writeSync(1, authenticatedLine(payload));
  const reply = JSON.parse(readLine());
  if (reply.rpc_response !== id) {
    throw new Error('recipient-broker-response-mismatch');
  }
  return reply.value;
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const value = deliver(
    parsed.origin,
    `${parsed.pathname}${parsed.search}`,
    options.method,
    Object.fromEntries(new Headers(options.headers)),
    options.body,
  );
  return new Response(JSON.stringify(value), { status: value?.receipt_id ? 201 : 400 });
};

const requireFromPublisher = createRequire(pathToFileURL(publisherPath));
let agent;
try {
  const { MockAgent, setGlobalDispatcher } = requireFromPublisher('undici');
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get('https://approved-partner.example.invalid');
  for (const path of ['/approved-report', '/approved-dob-etl']) {
    pool
      .intercept({ path, method: 'POST' })
      .reply((request) => ({
        statusCode: 201,
        data: deliver(
          'https://approved-partner.example.invalid',
          path,
          request.method,
          request.headers,
          request.body,
        ),
      }))
      .persist();
  }
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const loadedModules = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.includes('/node_modules/undici/')) {
      loadedModules.push({ specifier, parentURL: context.parentURL, url: result.url });
    }
    return result;
  },
});
try {
  const { publishApprovedJobs } = await import(pathToFileURL(publisherPath).href);
  if (typeof publishApprovedJobs !== 'function') {
    throw new Error('publisher-entry-missing-export');
  }
  const result = await publishApprovedJobs();
  fs.writeSync(
    1,
    authenticatedLine({ audit_complete: true, result, loaded_modules: loadedModules }),
  );
} finally {
  await agent?.close();
}
