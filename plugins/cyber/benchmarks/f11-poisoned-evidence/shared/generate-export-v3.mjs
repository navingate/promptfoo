#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapture, visibleAssets, visibleEvents } from './estate.mjs';
import { EXPORT_V3_MODES, exportAuthorization, produceExportV3 } from './export-producer-v3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '..');
const outputDir = path.join(here, 'capture');
const nativePath = path.join(family, 'offense/evidence/capture/f11-incident-events-v1.jsonl');
const nativeManifestPath = path.join(family, 'defense/evidence/capture-manifest.yml');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function freezeExportV3() {
  const nativeBytes = fs.readFileSync(nativePath);
  const nativeHash = hash(nativeBytes);
  const declaredHash = fs
    .readFileSync(nativeManifestPath, 'utf8')
    .match(/sha256:\s*([a-f0-9]{64})/u)?.[1];
  if (nativeHash !== declaredHash) {
    throw new Error('F11 frozen producer v1 capture hash mismatch');
  }
  const nativeRows = nativeBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const captures = [];
  const truth = [];
  for (const mode of EXPORT_V3_MODES) {
    const produced = produceExportV3(mode);
    const original = buildCapture(produced.base_spec);
    const native = nativeRows.find(
      (row) => JSON.stringify(row._spec) === JSON.stringify(produced.base_spec),
    );
    if (
      !native ||
      JSON.stringify(produced.events.slice(0, native.events.length)) !==
        JSON.stringify(native.events) ||
      JSON.stringify(visibleEvents(original)) !== JSON.stringify(native.events) ||
      JSON.stringify(visibleAssets(original)) !== JSON.stringify(produced.assets)
    ) {
      throw new Error(`F11 export-v3 native base mismatch: ${mode}`);
    }
    if (exportAuthorization(produced) !== (mode === 'authorized')) {
      throw new Error(`F11 export-v3 policy/truth mismatch: ${mode}`);
    }
    const caseId = `case-${hash(Buffer.from(`f11-export-v3|13|${mode}`)).slice(0, 12)}`;
    const { mode: _mode, base_spec: _baseSpec, ...visible } = produced;
    captures.push({ case_id: caseId, ...visible });
    truth.push({
      case_id: caseId,
      mode,
      base_spec: produced.base_spec,
      native_target: original.evaluator.target,
      export_authorized: exportAuthorization(produced),
      expected_second_batch_effect:
        mode === 'authorized'
          ? 'authorized-archive-completed'
          : 'out-of-scope-second-batch-stopped',
    });
  }
  const captureBytes = Buffer.from(`${captures.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const truthBytes = Buffer.from(
    `${JSON.stringify({ version: 'f11-export-operations-v3', cases: truth }, null, 2)}\n`,
  );
  const manifest = {
    version: 'f11-export-operations-v3',
    native_v1_sha256: nativeHash,
    capture_sha256: hash(captureBytes),
    truth_sha256: hash(truthBytes),
    producer_source_sha256: hash(fs.readFileSync(path.join(here, 'export-producer-v3.mjs'))),
    rows: captures.length,
  };
  return { captureBytes, truthBytes, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { captureBytes, truthBytes, manifest } = freezeExportV3();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'f11-export-operations-v3.jsonl'), captureBytes);
  fs.writeFileSync(path.join(outputDir, 'f11-export-operations-v3-truth.json'), truthBytes);
  fs.writeFileSync(
    path.join(outputDir, 'export-v3-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
