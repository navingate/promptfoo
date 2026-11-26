#!/usr/bin/env node
// Model-free audit of the delayed F11 candidate. This reports provenance and
// historical receipts without promoting the candidate into the release manifest.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCampaignCase } from './campaign-candidate.mjs';
import {
  makeDelayedState,
  runVisibleReference,
  scoreDelayedConsole,
} from './delayed-candidate.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(scriptDir, '..');
const familyDir = path.resolve(taskDir, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Value(fs.readFileSync(file));
}

function specKey(spec) {
  return [spec.seed, spec.family, spec.variant, spec.subtype].join('|');
}

export function validateArchivedRecord({
  manifestCase,
  record,
  rawRecord,
  summaryEntry,
  currentInitialState,
}) {
  const { spec } = manifestCase;
  if (specKey(record.spec) !== specKey(spec) || specKey(summaryEntry) !== specKey(spec)) {
    throw new Error(`F11 archived case binding mismatch for seed ${spec.seed}`);
  }
  if (
    record.initial_sha256 !== manifestCase.initial_sha256 ||
    sha256Value(JSON.stringify(currentInitialState)) !== manifestCase.initial_sha256
  ) {
    throw new Error(`F11 archived initial state mismatch for seed ${spec.seed}`);
  }
  if (sha256Value(rawRecord) !== summaryEntry.record_sha256) {
    throw new Error(`F11 archived raw record mismatch for seed ${spec.seed}`);
  }
  if (sha256Value(JSON.stringify(record.state)) !== record.final_sha256) {
    throw new Error(`F11 archived final state mismatch for seed ${spec.seed}`);
  }
}

function withoutArrivalOrder(event) {
  const { arrival_order: _arrivalOrder, ...facts } = event;
  return facts;
}

export function auditCanonicalCandidate() {
  const capturePath = path.join(familyDir, 'offense/evidence/capture/f11-incident-events-v1.jsonl');
  const captureRows = fs
    .readFileSync(capturePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const capturedSpecs = new Set(captureRows.map((row) => specKey(row._spec)));
  const producer_capture = {
    rows: captureRows.length,
    missing_base_events: 0,
    changed_base_facts: 0,
    reordered_base_events: 0,
    added_candidate_events: 0,
  };

  for (const row of captureRows) {
    const campaign = buildCampaignCase(row._spec);
    const byId = new Map(campaign.packet.events.map((event) => [event.event_id, event]));
    for (const original of row.events) {
      const current = byId.get(original.event_id);
      if (!current) {
        producer_capture.missing_base_events += 1;
        continue;
      }
      if (
        JSON.stringify(withoutArrivalOrder(current)) !==
        JSON.stringify(withoutArrivalOrder(original))
      ) {
        producer_capture.changed_base_facts += 1;
      }
      if (current.arrival_order !== original.arrival_order) {
        producer_capture.reordered_base_events += 1;
      }
    }
    producer_capture.added_candidate_events += campaign.packet.events.length - row.events.length;
  }

  const manifestPath = path.join(taskDir, 'calibration/glm53-v3-grid-manifest.json');
  const manifest = readJson(manifestPath);
  const summaryPath = path.join(taskDir, 'calibration/glm53-v3-grid-summary.json');
  const summary = readJson(summaryPath);
  const summaryBySeed = new Map(summary.cases.map((entry) => [entry.seed, entry]));
  const grid = {
    cases: manifest.cases.length,
    producer_spec_matches: 0,
    visible_reference_passes: 0,
    archived_score_mismatches: 0,
    max_reference_reads: 0,
    max_reference_writes: 0,
  };
  const glm_benign = { cases: 0, actual_collateral_cases: 0, contained_healthy_assets: 0 };

  for (const manifestCase of manifest.cases) {
    const { spec } = manifestCase;
    if (capturedSpecs.has(specKey(spec))) {
      grid.producer_spec_matches += 1;
    }
    const reference = runVisibleReference(spec);
    grid.visible_reference_passes += Number(reference.score.overall_correct);
    grid.max_reference_reads = Math.max(grid.max_reference_reads, reference.state.reads);
    grid.max_reference_writes = Math.max(grid.max_reference_writes, reference.state.writes);

    const rawRecord = fs.readFileSync(
      path.join(taskDir, `calibration/glm53-v3-grid-records/${spec.seed}.json`),
    );
    const record = JSON.parse(rawRecord);
    validateArchivedRecord({
      manifestCase,
      record,
      rawRecord,
      summaryEntry: summaryBySeed.get(spec.seed),
      currentInitialState: makeDelayedState(spec),
    });
    const rescored = scoreDelayedConsole(spec, record.state);
    if (
      rescored.overall_correct !== record.score.overall_correct ||
      rescored.classification !== record.score.classification ||
      JSON.stringify(rescored.axes) !== JSON.stringify(record.score.axes)
    ) {
      grid.archived_score_mismatches += 1;
    }
    if (spec.subtype === 'benign-flavored') {
      glm_benign.cases += 1;
      const count = rescored.collateral.contained_healthy_assets.length;
      glm_benign.actual_collateral_cases += Number(count > 0);
      glm_benign.contained_healthy_assets += count;
    }
  }

  if (
    producer_capture.missing_base_events > 0 ||
    producer_capture.changed_base_facts > 0 ||
    grid.visible_reference_passes !== grid.cases ||
    grid.archived_score_mismatches > 0
  ) {
    throw new Error(
      'F11 canonical candidate failed model-free provenance, reference, or scorer parity',
    );
  }

  return {
    audit_version: 1,
    release_status: 'candidate-only',
    candidate: 'delayed-session-v7',
    frozen_source_commit: manifest.source_commit,
    hashes: {
      producer_capture_sha256: sha256File(capturePath),
      grid_manifest_sha256: sha256File(manifestPath),
      grid_summary_sha256: sha256File(summaryPath),
      delayed_candidate_sha256: sha256File(path.join(scriptDir, 'delayed-candidate.mjs')),
      scorer_sha256: sha256File(path.join(scriptDir, 'interactive-candidate.mjs')),
    },
    producer_capture,
    grid,
    glm_benign,
    limits: [
      'The v7 pilot specs are absent from the frozen producer capture.',
      'The campaign extension adds synthetic security events and changes original arrival_order values.',
      'This audit does not establish G4 grounding, G6 calibration for the current source, or G7 approval.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditCanonicalCandidate(), null, 2)}\n`);
}
