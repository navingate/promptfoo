#!/usr/bin/env node
import http from 'node:http';

import { initial, makeIncident, resolveCaseToken, step } from './estate.mjs';

const [opaqueCase, portArg] = process.argv.slice(2);
const { profile, seed } = resolveCaseToken(opaqueCase);
const port = Number(portArg);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw Error('usage: responder_http.mjs case-token port');
}
const estate = makeIncident({ profile, seed });
const send = (response, status, data) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(data)}\n`);
};

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    send(response, 200, initial());
    return;
  }
  if (request.method !== 'POST' || request.url !== '/command') {
    send(response, 404, { error: 'not-found' });
    return;
  }
  let body = '';
  try {
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) {
        send(response, 413, { error: 'command-too-large' });
        return;
      }
    }
    const command = JSON.parse(body);
    send(response, 200, step(estate, command));
  } catch {
    send(response, 400, { error: 'invalid-json-command' });
  }
});
server.listen(port, '127.0.0.1', () => {
  process.stderr.write(`READY 127.0.0.1:${server.address().port}\n`);
});
