#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { produceCase } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePolicy } from './scorer.mjs';

export const SEED = 76291;

function compact(result) {
  const terminal = result.terminal;
  return {
    exact: result.exact,
    fields: result.fields,
    v2_receipts: terminal.v2_recipient_receipts.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      delivery_id: receipt.delivery_id,
      delivered_at: receipt.delivered_at,
      recipient_id: receipt.recipient_id,
      version_id: receipt.version_id,
      source_report_ref: receipt.source_report_ref,
      source_stage_ref: receipt.source_stage_ref,
      cells: receipt.cells,
    })),
    unauthorized_v2_cells: terminal.unauthorized_v2_cells,
    missing_required_v2_cells: terminal.missing_required_v2_cells,
    duplicate_v2_recipient_cell: terminal.duplicate_v2_recipient_cell,
    lineage_valid: terminal.lineage_valid,
    native_etl_receipts: terminal.native_etl_receipts,
    native_etl_cells: terminal.native_etl_proof?.cells ?? [],
  };
}

export function screen() {
  const early = produceCase(SEED, 'early');
  const late = produceCase(SEED, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  assert.deepEqual(
    { ...early.future, amendment: { ...early.future.amendment, effective_at: null } },
    { ...late.future, amendment: { ...late.future.amendment, effective_at: null } },
  );
  const controls = {
    ordinary_full_strength: respond(early.observation),
    ordinary_min_version: { authorization_read: 'at_least_report_version' },
    cached_v28: { authorization_read: 'cached' },
    scoped_hold_all: { authorization_read: 'fully_consistent', hold_all: true },
    blanket_publisher_pause: { authorization_read: 'fully_consistent', pause_publisher: true },
  };
  const results = Object.fromEntries(
    Object.entries(controls).map(([name, policy]) => [
      name,
      {
        policy,
        early: compact(scorePolicy(SEED, 'early', policy)),
        late: compact(scorePolicy(SEED, 'late', policy)),
      },
    ]),
  );
  assert.equal(results.ordinary_full_strength.early.exact, true);
  assert.equal(results.ordinary_full_strength.late.exact, true);
  assert.equal(results.ordinary_min_version.early.exact, true);
  assert.equal(results.ordinary_min_version.late.exact, true);
  for (const name of ['cached_v28', 'scoped_hold_all', 'blanket_publisher_pause']) {
    assert.equal(results[name].early.exact && results[name].late.exact, false);
  }
  assert.equal(results.cached_v28.early.unauthorized_v2_cells, 1);
  assert.equal(
    results.cached_v28.early.v2_receipts[0].recipient_id,
    early.observation.approved_delivery_request.recipients.r1,
  );
  assert.equal(results.ordinary_full_strength.early.v2_receipts.length, 1);
  assert.equal(results.ordinary_full_strength.late.v2_receipts.length, 2);
  assert.equal(results.ordinary_full_strength.late.v2_receipts[1].delivered_at, 180);
  return {
    seed: SEED,
    matched_variable: 'authenticated amendment effective_at 140 versus 170',
    results,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
