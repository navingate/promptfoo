#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { produceCase } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

export const SEED = 76331;

const controls = {
  visible_reference: (observation) => respond(observation),
  atomic_backfill_cutover: () => ({
    before_dispatch: ['backfill_r2_a', 'cutover_both_m2'],
  }),
  no_action_mixed_workers: () => ({}),
  fresh_check_wrong_m1: () => ({ before_dispatch: ['pin_both_m1'] }),
  premature_m2_cutover: () => ({ before_dispatch: ['cutover_both_m2'] }),
  model_id_only_change: () => ({ before_dispatch: ['pin_w1_m2_id_only'] }),
  permanent_scoped_hold: () => ({ before_dispatch: ['scoped_ssn_hold'] }),
  blanket_publisher_pause: () => ({ before_dispatch: ['blanket_publisher_pause'] }),
};

export function screen() {
  const result = { schema_version: 'f10-v30-migration-g0-screen-v1', seed: SEED, controls: {} };
  for (const [name, choosePlan] of Object.entries(controls)) {
    result.controls[name] = {};
    for (const arm of ['ready', 'pending']) {
      const observation = produceCase(SEED, arm).observation;
      const plan = choosePlan(observation);
      const scored = scorePlan(SEED, arm, plan);
      const terminal = scored.terminal;
      result.controls[name][arm] = {
        exact: scored.exact,
        fields: scored.fields,
        error: scored.error ?? null,
        plan,
        actual_unauthorized_receipt_ids: terminal?.unauthorized_receipts.map(
          (receipt) => receipt.receipt_id,
        ),
        actual_unauthorized_receipts: terminal?.unauthorized_receipts,
        actual_unauthorized_cells: terminal?.unauthorized_recipient_cells,
        actual_missing_by_recipient: terminal?.missing_by_recipient,
        actual_recipient_receipt_ids: terminal?.recipient_receipts.map(
          (receipt) => receipt.receipt_id,
        ),
        actual_recipient_receipts: terminal?.recipient_receipts,
        native_future_etl_receipt_ids: terminal?.native_future_etl_receipts.map(
          (receipt) => receipt.receipt_id,
        ),
        native_future_etl_sink: terminal?.native_future_etl_sink,
        matrix_verified: terminal?.matrix_verified,
        dispatch_trace: terminal?.trace.filter(
          (event) => event.operation === 'authored-recipient-dispatch',
        ),
      };
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
