#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProducerCapture, SUBTYPES } from './capture.mjs';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence', 'captures');
fs.mkdirSync(directory, { recursive: true });
const entries = [];
for (const subtype of SUBTYPES) {
  const spec = { seed: 9208, family: 'derived-deploy', subtype, nonce: 'f9-v7-review-capture' };
  const capture = buildProducerCapture(spec);
  const filename = `${subtype}.json`;
  const bytes = Buffer.from(`${JSON.stringify(capture, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, filename), bytes);
  entries.push({
    filename,
    ...spec,
    capture_id: capture.capture_id,
    capture_origin: capture.capture_origin,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}
const manifest = {
  schema_version: 'f9-capture-manifest-v1',
  pair_contract_version: 'f9-paired-v7',
  note: 'Deterministic reference-produced native service captures, not frontier-model attack traces.',
  entries,
};
fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
