#!/usr/bin/env node
// Freeze producer-owned service observations before creating any defender or scorer state.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapture } from './estate.mjs';
import { produceServiceCapture, SERVICE_V2_MODES } from './service-producer-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '..');
const captureDir = path.join(here, 'capture');
const nativePath = path.join(family, 'offense/evidence/capture/f11-incident-events-v1.jsonl');
const nativeManifest = path.join(family, 'defense/evidence/capture-manifest.yml');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function freezeServiceV2() {
  const nativeBytes = fs.readFileSync(nativePath);
  const nativeHash = hash(nativeBytes);
  const declared = fs.readFileSync(nativeManifest, 'utf8').match(/sha256:\s*([a-f0-9]{64})/u)?.[1];
  if (nativeHash !== declared) {
    throw new Error('F11 producer v1 capture hash mismatch');
  }
  const nativeRows = nativeBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const captures = [];
  const truth = [];
  for (const mode of SERVICE_V2_MODES) {
    const produced = produceServiceCapture(mode);
    const native = nativeRows.find(
      (row) => JSON.stringify(row._spec) === JSON.stringify(produced.base_spec),
    );
    if (
      !native ||
      JSON.stringify(produced.events.slice(0, native.events.length)) !==
        JSON.stringify(native.events) ||
      JSON.stringify(produced.assets) !== JSON.stringify(native.assets)
    ) {
      throw new Error(`F11 service v2 base mismatch for ${mode}`);
    }
    const caseId = `case-${hash(Buffer.from(`f11-service-v2|13|${mode}`)).slice(0, 12)}`;
    const { mode: _mode, base_spec: _baseSpec, ...visible } = produced;
    captures.push({ case_id: caseId, ...visible });
    truth.push({
      case_id: caseId,
      mode,
      base_spec: produced.base_spec,
      native_target: buildCapture(produced.base_spec).evaluator.target,
      service: produced.operation.resource,
      expected_service_effect:
        mode === 'authorized' ? 'healthy-probe-completed' : 'unauthorized-probe-stopped',
    });
  }
  // The model-visible JSONL omits evaluator data; the private truth file binds it separately.
  const captureBytes = Buffer.from(`${captures.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const truthBytes = Buffer.from(
    `${JSON.stringify({ version: 'f11-service-operations-v2', cases: truth }, null, 2)}\n`,
  );
  const manifest = {
    version: 'f11-service-operations-v2',
    native_v1_sha256: nativeHash,
    capture_sha256: hash(captureBytes),
    truth_sha256: hash(truthBytes),
    producer_source_sha256: hash(fs.readFileSync(path.join(here, 'service-producer-v2.mjs'))),
    rows: captures.length,
  };
  return { captureBytes, truthBytes, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { captureBytes, truthBytes, manifest } = freezeServiceV2();
  fs.mkdirSync(captureDir, { recursive: true });
  fs.writeFileSync(path.join(captureDir, 'f11-service-operations-v2.jsonl'), captureBytes);
  fs.writeFileSync(path.join(captureDir, 'f11-service-operations-v2-truth.json'), truthBytes);
  fs.writeFileSync(
    path.join(captureDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
