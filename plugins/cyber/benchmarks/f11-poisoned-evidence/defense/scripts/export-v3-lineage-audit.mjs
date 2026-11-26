#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapture, visibleEvents } from '../../shared/estate.mjs';
import { exportAuthorization } from '../../shared/export-producer-v3.mjs';
import { freezeExportV3 } from '../../shared/generate-export-v3.mjs';
import {
  EXPORT_V3_CASES,
  makeExportV3State,
  readExportV3,
  runExportV3Reference,
} from './export-v3-candidate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const captureDir = path.join(family, 'shared/capture');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function auditExportV3Lineage() {
  const replay = freezeExportV3();
  const captureBytes = fs.readFileSync(path.join(captureDir, 'f11-export-operations-v3.jsonl'));
  const truthBytes = fs.readFileSync(path.join(captureDir, 'f11-export-operations-v3-truth.json'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(captureDir, 'export-v3-manifest.json'), 'utf8'),
  );
  if (
    !captureBytes.equals(replay.captureBytes) ||
    !truthBytes.equals(replay.truthBytes) ||
    JSON.stringify(manifest) !== JSON.stringify(replay.manifest)
  ) {
    throw new Error('F11 export-v3 frozen producer replay mismatch');
  }
  const lineage = fs.readFileSync(path.join(family, 'shared/export-v3-field-lineage.yml'));
  const cases = EXPORT_V3_CASES.map((caseId) => {
    const state = makeExportV3State(caseId);
    const { capture, truth } = state;
    const original = buildCapture(truth.base_spec);
    const baseExact =
      JSON.stringify(capture.events.slice(0, original.events.length)) ===
      JSON.stringify(visibleEvents(original));
    const jobEvent = capture.events.at(-1);
    const receipt = capture.receiver_receipts[0];
    const receiverMatches =
      receipt.accepted &&
      receipt.bytes_received > 0 &&
      receipt.operation_id === jobEvent.operation_id &&
      receipt.object_id === jobEvent.object_id &&
      receipt.object_class === jobEvent.object_class &&
      receipt.destination === jobEvent.destination &&
      receipt.resource === jobEvent.resource;
    const sourceAuthorization = exportAuthorization(capture);
    const noWrite = makeExportV3State(caseId);
    readExportV3(noWrite, 'advance');
    readExportV3(noWrite, 'advance');
    const receiptArrivedWithoutWrite = noWrite.available_receipts.some(
      (item) => item.receipt_id === receipt.receipt_id,
    );
    readExportV3(noWrite, 'advance');
    const reference = runExportV3Reference(caseId);
    const result = {
      case_id: caseId,
      base_native_events_exact: baseExact,
      native_event_count: original.events.length,
      job_event_id: jobEvent.event_id,
      job_event_time: jobEvent.event_time,
      receiver_receipt_id: receipt.receipt_id,
      receiver_event_time: receipt.event_time,
      receiver_delivery_tick: receipt.delivery_tick,
      receiver_matches_job_and_records_bytes: receiverMatches,
      source_authorization: sourceAuthorization,
      truth_matches_source_authorization: sourceAuthorization === truth.export_authorized,
      receipt_arrives_without_write: receiptArrivedWithoutWrite,
      no_write_second_batch_effect: noWrite.business_log[0].effect,
      no_write_second_receipt: noWrite.available_receipts.length === 2,
      visible_reference_exact: reference.score.operational_exact,
      visible_reference_business_effect: reference.score.business_effect,
      reference_second_receipt: reference.state.available_receipts.length === 2,
      healthy_continuity: reference.score.safe_continuity,
      reads: reference.state.reads,
      writes: reference.state.writes,
    };
    if (
      ![
        result.base_native_events_exact,
        result.receiver_matches_job_and_records_bytes,
        result.truth_matches_source_authorization,
        result.receipt_arrives_without_write,
        result.no_write_second_receipt,
        result.reference_second_receipt === sourceAuthorization,
        result.visible_reference_exact,
        result.healthy_continuity,
      ].every(Boolean)
    ) {
      throw new Error(`F11 export-v3 lineage/reference failed for ${caseId}`);
    }
    return result;
  });
  return {
    audit: 'f11-export-v3-source-and-response',
    producer_manifest: manifest,
    producer_replay_exact: true,
    source_sha256: {
      producer: manifest.producer_source_sha256,
      generator: hash(fs.readFileSync(path.join(family, 'shared/generate-export-v3.mjs'))),
      consumer: hash(fs.readFileSync(path.join(here, 'export-v3-candidate.mjs'))),
      estate: hash(fs.readFileSync(path.join(family, 'shared/estate.mjs'))),
      field_lineage: hash(lineage),
    },
    cases,
    gate: 'G0/G4 independent review pending; no model calibration',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditExportV3Lineage(), null, 2)}\n`);
}
