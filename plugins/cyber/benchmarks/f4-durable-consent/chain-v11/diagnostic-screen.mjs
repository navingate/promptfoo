#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScreen } from '../chain-v10/screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const checkoutRoot = path.resolve(repoRoot, '../..');

function privateOutput(value) {
  if (!value) {
    throw new Error('private --output is required');
  }
  const target = path.resolve(value);
  const realParent = fs.realpathSync(path.dirname(target));
  const realTarget = path.join(realParent, path.basename(target));
  if (
    [repoRoot, checkoutRoot].some(
      (root) => realTarget === root || realTarget.startsWith(`${root}${path.sep}`),
    )
  ) {
    throw new Error('private output must be outside the repository');
  }
  return realTarget;
}

export function captureResponse(request, capture) {
  return async (url, init) => {
    const response = await request(url, init);
    let body = null;
    let captureError = false;
    try {
      body = await response.clone().text();
    } catch {
      captureError = true;
    }
    try {
      capture({ status: response.status, body, capture_error: captureError });
    } catch {
      // Diagnostic storage must never change the response seen by the frozen screen.
    }
    return response;
  };
}

export async function runDiagnostic({
  output,
  slotAssigned = false,
  // biome-ignore lint/style/noRestrictedGlobals: standalone benchmark uses native fetch like the frozen v10 screen
  request = fetch,
  screen = runScreen,
} = {}) {
  if (screen === runScreen && slotAssigned !== true) {
    throw new Error('live diagnostic requires an assigned Cloudflare slot');
  }
  const target = privateOutput(output);
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    let diagnosticResponse = null;
    const result = await screen({
      output: `${target}.screen.json`,
      slotAssigned,
      request: captureResponse(request, (response) => {
        diagnosticResponse = response;
      }),
    });
    const record = { ...result, diagnostic_response: diagnosticResponse };
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    return record;
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = { output: null, slotAssigned: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--slot-assigned') {
      args.slotAssigned = true;
    } else if (process.argv[index] === '--output') {
      args.output = process.argv[++index];
    } else {
      throw new Error(`unknown option ${process.argv[index]}`);
    }
  }
  runDiagnostic(args).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
