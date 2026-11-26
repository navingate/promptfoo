#!/usr/bin/env node
// Model-free comparison of the producer's immutable v1 capture and the delayed defense overlay.
// A generated defense event is not producer-native merely because it shares the estate's field shape.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCampaignCase } from './campaign-candidate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const capturePath = path.join(family, 'offense/evidence/capture/f11-incident-events-v1.jsonl');
const captureManifestPath = path.join(family, 'defense/evidence/capture-manifest.yml');
const gridManifestPath = path.join(
  family,
  'defense/calibration/delayed-collateral-grid-manifest.json',
);
const producerLineagePath = path.join(family, 'offense/field-lineage.yml');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const specKey = (spec) => [spec.seed, spec.family, spec.variant, spec.subtype].join('|');

export function auditDelayedNativeFeasibility() {
  const captureBytes = fs.readFileSync(capturePath);
  const captureHash = hash(captureBytes);
  const declaredHash = fs
    .readFileSync(captureManifestPath, 'utf8')
    .match(/sha256:\s*([a-f0-9]{64})/u)?.[1];
  if (captureHash !== declaredHash) {
    throw new Error('Producer v1 capture differs from its frozen consumer manifest');
  }
  const rows = captureBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const gridBytes = fs.readFileSync(gridManifestPath);
  const grid = JSON.parse(gridBytes.toString('utf8'));
  const sourceSpecs = new Set(rows.map((row) => specKey(row._spec)));
  const sourceEvents = rows.flatMap((row) => row.events);
  const sourceFields = [...new Set(sourceEvents.flatMap((event) => Object.keys(event)))].sort();
  const lineageBytes = fs.readFileSync(producerLineagePath);
  const declaredFields = [
    ...lineageBytes.toString('utf8').matchAll(/normalized_path: (\w+)/gu),
  ].map((match) => match[1]);
  const overlay = {
    added_events: 0,
    base_arrival_orders_rewritten: 0,
    base_nonarrival_fields_changed: 0,
    added_change_records: 0,
  };
  for (const row of rows) {
    const candidate = buildCampaignCase(row._spec);
    const nativeById = new Map(row.events.map((event) => [event.event_id, event]));
    overlay.added_change_records += candidate.packet.changes.length;
    for (const event of candidate.packet.events) {
      const native = nativeById.get(event.event_id);
      if (!native) {
        overlay.added_events += 1;
        continue;
      }
      if (native.arrival_order !== event.arrival_order) {
        overlay.base_arrival_orders_rewritten += 1;
      }
      for (const [field, value] of Object.entries(native)) {
        if (field !== 'arrival_order' && JSON.stringify(value) !== JSON.stringify(event[field])) {
          overlay.base_nonarrival_fields_changed += 1;
        }
      }
    }
  }
  return {
    audit: 'f11-delayed-native-feasibility-v1',
    source_capture: {
      sha256: captureHash,
      rows: rows.length,
      event_fields: sourceFields,
      session_id_events: sourceEvents.filter((event) => 'session_id' in event).length,
      peer_resource_events: sourceEvents.filter((event) => 'peer_resource' in event).length,
      change_records: rows.reduce((sum, row) => sum + (row.changes?.length ?? 0), 0),
      grid_specs_present: grid.cases.filter((item) => sourceSpecs.has(specKey(item.spec))).length,
      grid_specs_total: grid.cases.length,
    },
    frozen_grid_manifest_sha256: hash(gridBytes),
    producer_field_lineage_sha256: hash(lineageBytes),
    lineage: {
      producer_unmapped_native_fields: sourceFields.filter(
        (field) => !declaredFields.includes(field),
      ),
      producer_declared_absent_fields: declaredFields
        .filter((field) => !sourceFields.includes(field))
        .sort(),
    },
    overlay,
    conclusion: 'delayed-v7-not-producer-native',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditDelayedNativeFeasibility(), null, 2)}\n`);
}
