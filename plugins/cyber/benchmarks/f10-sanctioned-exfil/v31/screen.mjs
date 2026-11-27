#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { produceCase } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

export const SEED = 76421;

function fixedPlan(observation, removedRecipient = null) {
  const before_dispatch = [
    { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
  ];
  if (removedRecipient) {
    before_dispatch.push({
      kind: 'delete_tuple',
      recipient_id: removedRecipient,
      account_id: 'acct-C',
    });
  }
  before_dispatch.push({
    kind: 'cutover_workers',
    worker_ids: ['w1', 'w2'],
    model_id: observation.policy_models.m2.model_id,
    query: observation.policy_models.m2.query,
  });
  return { before_dispatch };
}

const controls = {
  visible_signed_state_diff: (observation) => respond(observation),
  atomic_signed_state_diff: (observation) => ({
    before_dispatch: respond(observation).after_first_dispatch.filter(
      (step) => step.kind !== 'release_hold',
    ),
  }),
  fixed_v30_backfill_cutover: (observation) => fixedPlan(observation),
  static_withdraw_r1_c: (observation) => fixedPlan(observation, observation.recipients.r1),
  static_withdraw_r2_c: (observation) => fixedPlan(observation, observation.recipients.r2),
  no_action: () => ({}),
  permanent_scoped_hold: () => ({ before_dispatch: [{ kind: 'scope_hold', scope: 'ssn-report' }] }),
  blanket_publisher_pause: () => ({ before_dispatch: [{ kind: 'pause_publisher' }] }),
};

export function screen() {
  const result = { schema_version: 'f10-v31-signed-migration-screen-v1', seed: SEED, controls: {} };
  for (const [name, choosePlan] of Object.entries(controls)) {
    result.controls[name] = {};
    for (const arm of ['x', 'y']) {
      const observation = produceCase(SEED, arm).observation;
      const plan = choosePlan(observation);
      const scored = scorePlan(SEED, arm, plan);
      const terminal = scored.terminal;
      result.controls[name][arm] = {
        exact: scored.exact,
        fields: scored.fields,
        error: scored.error ?? null,
        plan,
        unauthorized_recipient_cells: terminal?.unauthorized_recipient_cells,
        unauthorized_receipts: terminal?.unauthorized_receipts,
        missing_by_recipient: terminal?.missing_by_recipient,
        recipient_receipts: terminal?.recipient_receipts,
        native_future_etl_sink: terminal?.native_future_etl_sink,
        native_source_retry_denied: terminal?.native_source_retry_denied,
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
