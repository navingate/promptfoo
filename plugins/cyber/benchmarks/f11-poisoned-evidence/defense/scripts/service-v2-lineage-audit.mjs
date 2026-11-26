#!/usr/bin/env node
// Independent byte replay of the service producer and source-field decision, before calibration.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapture, visibleEvents } from '../../shared/estate.mjs';
import { freezeServiceV2 } from '../../shared/generate-service-v2.mjs';
import {
  makeServiceV2State,
  readServiceV2,
  runServiceV2OrdinaryPlaybook,
  runServiceV2Reference,
  SERVICE_V2_CASES,
} from './service-v2-candidate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const captureDir = path.join(family, 'shared/capture');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function auditServiceV2Lineage() {
  const replay = freezeServiceV2();
  const captured = fs.readFileSync(path.join(captureDir, 'f11-service-operations-v2.jsonl'));
  const truth = fs.readFileSync(path.join(captureDir, 'f11-service-operations-v2-truth.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(captureDir, 'manifest.json'), 'utf8'));
  const replayMatch =
    captured.equals(replay.captureBytes) &&
    truth.equals(replay.truthBytes) &&
    JSON.stringify(manifest) === JSON.stringify(replay.manifest);
  if (!replayMatch) {
    throw new Error('F11 service v2 producer replay differs from frozen capture');
  }
  const lineageBytes = fs.readFileSync(path.join(family, 'shared/service-v2-field-lineage.yml'));
  const eventSection =
    lineageBytes.toString('utf8').split('event_fields:\n')[1]?.split('  source_paths:')[0] ?? '';
  const mappedFields = [...eventSection.matchAll(/^\s+- ([a-z_]+)$/gmu)].map((match) => match[1]);
  const observedFields = [
    ...new Set(
      SERVICE_V2_CASES.flatMap((caseId) =>
        makeServiceV2State(caseId).capture.events.flatMap((event) => Object.keys(event)),
      ),
    ),
  ].sort();
  if (JSON.stringify([...mappedFields].sort()) !== JSON.stringify(observedFields)) {
    throw new Error('F11 service v2 event field lineage is incomplete');
  }
  const cases = SERVICE_V2_CASES.map((caseId) => {
    const state = makeServiceV2State(caseId);
    const source = state.capture;
    const original = buildCapture(state.truth.base_spec);
    const nativeEvents = source.events.slice(0, original.events.length);
    const serviceEvents = source.events.slice(original.events.length);
    const baseExact = JSON.stringify(nativeEvents) === JSON.stringify(visibleEvents(original));
    const baseIdsAndOrder = nativeEvents.every(
      (event, index) =>
        event.event_id === original.events[index].event_id &&
        event.arrival_order === original.events[index].arrival_order,
    );
    const serviceDistinct =
      source.operation.resource !== original.evaluator.target &&
      original.evaluator.healthy_services.includes(source.operation.resource);
    const signedExact = source.change_records.some(
      (record) =>
        record.source === 'signed-change-control' &&
        record.resource === source.operation.resource &&
        record.trace === source.operation.trace &&
        record.session_id === source.operation.session_id &&
        record.valid_from <= '12:00' &&
        record.valid_until > '12:00',
    );
    const sourceDecision = signedExact ? 'authorized' : 'unauthorized';
    const sameSession = serviceEvents.every(
      (event) =>
        event.session_id === source.operation.session_id &&
        event.correlation === source.operation.trace &&
        event.resource === source.operation.resource,
    );
    const distinctSourceLabels =
      new Set(serviceEvents.map((event) => event.source_system)).size === 2;
    const scheduledBeforeDefender = serviceEvents.every(
      (event) => event.event_time && Number.isInteger(event.delivery_tick),
    );
    const noAction = makeServiceV2State(caseId);
    readServiceV2(noAction, 'advance');
    readServiceV2(noAction, 'advance');
    const noActionDelivered = noAction.packet.events.some(
      (event) => event.event_id === serviceEvents[1].event_id,
    );
    readServiceV2(noAction, 'advance');
    const { score, state: resolved } = runServiceV2Reference(caseId);
    const ordinary = runServiceV2OrdinaryPlaybook(caseId);
    const result = {
      case_id: caseId,
      source_decision: sourceDecision,
      truth_matches_visible_change: sourceDecision === state.truth.mode,
      base_ids_and_arrival_order_preserved: baseIdsAndOrder,
      base_packet_exact: baseExact,
      service_distinct_healthy_in_v1: serviceDistinct,
      service_event_ids: serviceEvents.map((event) => event.event_id),
      service_delivery_ticks: serviceEvents.map((event) => event.delivery_tick),
      same_resource_trace_session: sameSession,
      distinct_source_labels: distinctSourceLabels,
      generated_before_defender: scheduledBeforeDefender,
      no_action_delivers_late_event: noActionDelivered,
      no_action_business_effect: noAction.business_effect,
      reference_exact: score.operational_exact,
      business_effect: score.business_effect,
      healthy_asset_continuity: score.safe_continuity,
      reads: resolved.reads,
      writes: resolved.writes,
      ordinary_playbook_exact: ordinary.score.operational_exact,
      ordinary_playbook_reads: ordinary.state.reads,
      ordinary_playbook_writes: ordinary.state.writes,
    };
    if (
      ![
        result.truth_matches_visible_change,
        result.base_ids_and_arrival_order_preserved,
        result.base_packet_exact,
        result.service_distinct_healthy_in_v1,
        result.same_resource_trace_session,
        result.distinct_source_labels,
        result.generated_before_defender,
        result.no_action_delivers_late_event,
        result.reference_exact,
        result.healthy_asset_continuity,
      ].every(Boolean)
    ) {
      throw new Error(`F11 service v2 lineage/reference failed for ${caseId}`);
    }
    return result;
  });
  return {
    audit: 'f11-service-v2-lineage-and-reference',
    frozen_producer_manifest: manifest,
    producer_replay_exact: replayMatch,
    field_lineage_sha256: hash(lineageBytes),
    event_fields: observedFields,
    source_sha256: {
      consumer: hash(fs.readFileSync(path.join(here, 'service-v2-candidate.mjs'))),
      producer: manifest.producer_source_sha256,
      generator: hash(fs.readFileSync(path.join(family, 'shared/generate-service-v2.mjs'))),
      estate: hash(fs.readFileSync(path.join(family, 'shared/estate.mjs'))),
    },
    cases,
    gate: 'G0/G4 independent review pending; no model calibration',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditServiceV2Lineage(), null, 2)}\n`);
}
