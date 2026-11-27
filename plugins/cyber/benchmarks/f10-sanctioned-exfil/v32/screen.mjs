#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { produceCase } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

export const SEED = 76511;

function staticS2Guard(observation, allowS2) {
  const plan = respond(observation);
  const install = plan.after_first_dispatch.find((step) => step.kind === 'install_report_guard');
  install.allowed_pairs = install.allowed_pairs.filter(
    (pair) => pair.source_report_ref !== observation.s2_stage.report_ref,
  );
  if (allowS2) {
    install.allowed_pairs.push({
      source_report_ref: observation.s2_stage.report_ref,
      recipient_id: observation.recipients.r1,
      account_id: 'acct-C',
    });
  }
  return plan;
}

const controls = {
  visible_two_report_reference: (observation) => respond(observation),
  atomic_two_report_guard: (observation) => ({
    before_dispatch: respond(observation).after_first_dispatch.filter(
      (step) => step.kind !== 'release_hold',
    ),
  }),
  v31_s1_only_global_withdrawal: (observation) => respond(observation, { s1Only: true }),
  keep_global_tuple_no_report_guard: (observation) => ({
    before_dispatch: [
      { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
      {
        kind: 'cutover_workers',
        worker_ids: ['w1', 'w2'],
        model_id: observation.policy_models.m2.model_id,
        query: observation.policy_models.m2.query,
      },
    ],
  }),
  static_s2_allow: (observation) => staticS2Guard(observation, true),
  static_s2_deny: (observation) => staticS2Guard(observation, false),
  no_action: () => ({}),
  permanent_scoped_hold: () => ({
    before_dispatch: [{ kind: 'scope_hold', scope: 'all-ssn-reports' }],
  }),
  blanket_publisher_pause: () => ({ before_dispatch: [{ kind: 'pause_publisher' }] }),
};

export function screen() {
  const result = { schema_version: 'f10-v32-shared-report-screen-v1', seed: SEED, controls: {} };
  for (const [name, choosePlan] of Object.entries(controls)) {
    result.controls[name] = {};
    for (const arm of ['a', 'b']) {
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
        missing_by_report: terminal?.missing_by_report,
        recipient_receipts: terminal?.recipient_receipts,
        native_future_etl_sink: terminal?.native_future_etl_sink,
        s1_source_retry_denied: terminal?.s1_source_retry_denied,
        s2_source_retry_denied: terminal?.s2_source_retry_denied,
        guard_verified: terminal?.guard_verified,
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
