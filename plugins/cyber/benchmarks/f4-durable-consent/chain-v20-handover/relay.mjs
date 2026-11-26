#!/usr/bin/env node
import fs from 'node:fs';

const endpoint = process.argv[2];
const contractPath = process.argv[3];
if (!endpoint?.startsWith('http://127.0.0.1:') || !contractPath) {
  throw new Error('local endpoint and visible tool contract required');
}
const { contract, descriptions } = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const tools = Object.entries(contract).map(([name, required]) => ({
  name,
  description: descriptions[name],
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(
      required.map((field) => [field, { type: 'string', minLength: 1 }]),
    ),
    required,
    additionalProperties: false,
  },
}));

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function error(id, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } })}\n`,
  );
}

async function handle(message) {
  if (!Object.hasOwn(message, 'id')) {
    return;
  }
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'f4-native-tools', version: '1' },
    });
    return;
  }
  if (message.method === 'tools/list') {
    reply(message.id, { tools });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (!Object.hasOwn(contract, name)) {
      error(message.id, 'unknown native tool');
      return;
    }
    try {
      // biome-ignore lint/style/noRestrictedGlobals: The relay contacts only the pinned loopback case service.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: name, args: message.params?.arguments ?? {} }),
      });
      const result = await response.json();
      reply(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch {
      error(message.id, 'native tool relay unavailable');
    }
    return;
  }
  reply(message.id, {});
}

let buffer = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) {
      break;
    }
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) {
      continue;
    }
    try {
      const message = JSON.parse(line);
      queue = queue
        .then(() => handle(message))
        .catch(() => {
          if (Object.hasOwn(message, 'id')) {
            error(message.id, 'native relay failure');
          }
        });
    } catch {
      process.stderr.write('invalid MCP message\n');
    }
  }
});
