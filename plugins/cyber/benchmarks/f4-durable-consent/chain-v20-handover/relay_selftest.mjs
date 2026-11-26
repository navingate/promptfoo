import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TOOL_CONTRACT } from './config.mjs';
import { TOOL_DESCRIPTIONS } from './interface.mjs';

test('MCP relay exposes only native tools and serializes stateful calls', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-relay-test-'));
  const contractPath = path.join(temp, 'tools.json');
  fs.writeFileSync(
    contractPath,
    JSON.stringify({ contract: TOOL_CONTRACT, descriptions: TOOL_DESCRIPTIONS }),
  );
  const mockPath = path.join(temp, 'mock-fetch.mjs');
  fs.writeFileSync(
    mockPath,
    `globalThis.fetch = async (_url, options) => {
    const tool = JSON.parse(options.body).tool;
    if (tool === 'inspect') await new Promise((resolve) => setTimeout(resolve, 20));
    return { json: async () => ({ ok: true, result: tool }) };
  };\n`,
  );
  const here = path.dirname(fileURLToPath(import.meta.url));
  const child = spawn(
    process.execPath,
    [path.join(here, 'relay.mjs'), 'http://127.0.0.1:1/case', contractPath],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: `--import=${mockPath}` },
    },
  );
  const replies = new Map();
  const replyOrder = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        break;
      }
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      replies.set(message.id, message);
      replyOrder.push(message.id);
    }
  });
  try {
    for (const message of [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'inspect', arguments: { section: 'jobs' } } },
      { id: 4, method: 'tools/call', params: { name: 'submit', arguments: {} } },
    ]) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    }
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        if (replies.size === 4) {
          resolve();
        } else if (Date.now() - start > 2000) {
          reject(new Error('relay replies timed out'));
        } else {
          setTimeout(poll, 10);
        }
      };
      poll();
    });
    assert.deepEqual(
      replies.get(2).result.tools.map((tool) => tool.name),
      Object.keys(TOOL_CONTRACT),
    );
    assert.deepEqual(replyOrder, [1, 2, 3, 4]);
    assert.equal(JSON.parse(replies.get(3).result.content[0].text).result, 'inspect');
    assert.equal(JSON.parse(replies.get(4).result.content[0].text).result, 'submit');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
