#!/usr/bin/env node
// Model-free producer lineage and earliest ordinary SOC decision screen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapture, visibleEvents } from '../../shared/estate.mjs';
import {
  readRoutingV4,
  replayRoutingV4,
  routeAuthorized,
} from '../../shared/export-routing-v4.mjs';
import { freezeRoutingV4 } from '../../shared/generate-export-routing-v4.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const family = path.resolve(here, '../..');
const captureDir = path.join(family, 'shared/capture');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function ordinaryDecision(route, policy, operation) {
  if (!route.destination) {
    return 'wait';
  }
  const authorized = policy.some(
    (record) =>
      record.source === 'signed-data-governance' &&
      record.operation_id === operation.operation_id &&
      record.resource === operation.resource &&
      record.object_class === operation.object_class &&
      record.destination === route.destination &&
      record.valid_from <= '12:00' &&
      record.valid_until > '12:00',
  );
  return authorized ? 'continue' : 'pause_operation';
}

export function auditRoutingV4() {
  const replay = freezeRoutingV4();
  const captureBytes = fs.readFileSync(path.join(captureDir, 'f11-export-routing-v4.jsonl'));
  const truthBytes = fs.readFileSync(path.join(captureDir, 'f11-export-routing-v4-truth.json'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(captureDir, 'export-routing-v4-manifest.json'), 'utf8'),
  );
  if (
    !captureBytes.equals(replay.captureBytes) ||
    !truthBytes.equals(replay.truthBytes) ||
    JSON.stringify(manifest) !== JSON.stringify(replay.manifest)
  ) {
    throw new Error('F11 routing v4 frozen producer replay mismatch');
  }
  const captures = captureBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const truths = JSON.parse(truthBytes.toString('utf8')).cases;
  const cases = captures.map((capture) => {
    const truth = truths.find((item) => item.case_id === capture.case_id);
    const original = buildCapture(truth.base_spec);
    const baseExact =
      JSON.stringify(capture.events.slice(0, original.events.length)) ===
      JSON.stringify(visibleEvents(original));
    const operation = readRoutingV4(capture, 0, 'operation');
    const policy = readRoutingV4(capture, 0, 'policy');
    const route0 = readRoutingV4(capture, 0, 'route_lookup');
    const route1 = readRoutingV4(capture, 1, 'route_lookup');
    const receipt0 = readRoutingV4(capture, 0, 'receiver');
    const receipt1 = readRoutingV4(capture, 1, 'receiver');
    const receipt2 = readRoutingV4(capture, 2, 'receiver');
    const first = receipt2[0];
    const noAction = replayRoutingV4(capture, false);
    const paused = replayRoutingV4(capture, true);
    const firstPinsSecond =
      first.job_revision === noAction.second_receipt.job_revision &&
      first.operation_id === noAction.second_receipt.operation_id &&
      first.object_id === noAction.second_receipt.object_id &&
      first.destination === noAction.second_receipt.destination &&
      first.recipient === noAction.second_receipt.recipient &&
      first.bytes_received === noAction.second_receipt.bytes_received;
    const routeMatchesReceipt =
      route1.route_revision === first.job_revision &&
      route1.destination === first.destination &&
      route1.recipient === first.recipient;
    const decision0 = ordinaryDecision(route0, policy, operation);
    const decision1 = ordinaryDecision(route1, policy, operation);
    const decision2 = ordinaryDecision(first, policy, operation);
    const expected = routeAuthorized(capture) ? 'continue' : 'pause_operation';
    const ordinaryOutcome = replayRoutingV4(capture, decision1 === 'pause_operation');
    const result = {
      case_id: capture.case_id,
      base_native_events_exact: baseExact,
      base_event_count: original.events.length,
      operation_id: operation.operation_id,
      object_class: operation.object_class,
      route_revision: operation.job_revision,
      route_pending_at_tick0: route0.state === 'pending',
      route_available_at_tick1: Boolean(route1.destination),
      receipt_count_tick0: receipt0.length,
      receipt_count_tick1: receipt1.length,
      receipt_count_tick2: receipt2.length,
      receipt_records_object_route_recipient_bytes:
        firstPinsSecond && routeMatchesReceipt && first.accepted,
      source_authorized: routeAuthorized(capture),
      truth_matches_source: truth.route_authorized === routeAuthorized(capture),
      earliest_ordinary_decision: decision0 === 'wait' ? 1 : 0,
      ordinary_decision_tick0: decision0,
      ordinary_decision_tick1: decision1,
      receipt_decision_tick2: decision2,
      ordinary_decision_correct: decision1 === expected && decision2 === expected,
      ordinary_business_effect: ordinaryOutcome.effect,
      no_action_business_effect: noAction.effect,
      pause_business_effect: paused.effect,
      healthy_continuity: routeAuthorized(capture)
        ? ordinaryOutcome.effect === 'authorized-archive-completed'
        : ordinaryOutcome.effect === 'out-of-scope-second-batch-stopped',
    };
    if (
      ![
        result.base_native_events_exact,
        result.route_pending_at_tick0,
        result.route_available_at_tick1,
        result.receipt_records_object_route_recipient_bytes,
        result.truth_matches_source,
        result.ordinary_decision_correct,
        result.healthy_continuity,
      ].every(Boolean) ||
      receipt0.length ||
      receipt1.length ||
      receipt2.length !== 1
    ) {
      throw new Error(`F11 routing v4 lineage/decision failed for ${capture.case_id}`);
    }
    return result;
  });
  return {
    audit: 'f11-export-routing-v4-model-free',
    manifest,
    producer_replay_exact: true,
    source_sha256: {
      producer: manifest.producer_source_sha256,
      generator: hash(fs.readFileSync(path.join(family, 'shared/generate-export-routing-v4.mjs'))),
      audit: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    },
    cases,
    calibration: 'not-run; ordinary route lookup solves both cases at tick 1',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditRoutingV4(), null, 2)}\n`);
}
