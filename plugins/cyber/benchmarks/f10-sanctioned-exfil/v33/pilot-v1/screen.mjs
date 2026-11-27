#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

function staticS2(item, allow) {
  const plan = structuredClone(item.answer);
  const install = plan.after_first_dispatch.find((step) => step.kind === 'install_report_guard');
  install.allowed_pairs = install.allowed_pairs.filter(
    (pair) => pair.source_report_ref !== item.observation.s2_stage.report_ref,
  );
  if (allow) {
    install.allowed_pairs.push({
      source_report_ref: item.observation.s2_stage.report_ref,
      recipient_id: item.observation.s2_pending_chunk.recipient_id,
      account_id: item.observation.s2_pending_chunk.account_id,
    });
  }
  return plan;
}

function s1Only(item) {
  const observation = item.observation;
  const _s1 = observation.signed_business_amendment;
  const r1 = observation.recipients.r1;
  const r2 = observation.recipients.r2;
  const c = observation.s2_pending_chunk.account_id;
  const a = observation.account_membership_ledger.owner_rows.find(
    (entry) => entry.row === 0,
  ).account_id;
  return {
    before_dispatch: [{ kind: 'scope_hold', scope: 'ssn-report' }],
    after_first_dispatch: [
      { kind: 'delete_tuple', recipient_id: r1, account_id: c },
      { kind: 'write_tuple', recipient_id: r2, account_id: a },
      {
        kind: 'cutover_workers',
        worker_ids: ['w1', 'w2'],
        model_id: observation.policy_models.m2.model_id,
        query: observation.policy_models.m2.query,
      },
      { kind: 'release_hold' },
    ],
  };
}

export function screen() {
  const result = { schema_version: 'f10-v33-shared-report-pilot-screen-v1', controls: {} };
  for (const [index, { seed, arm }] of CASE_ORDER.entries()) {
    const item = buildPilotCase(index);
    const choices = {
      visible_reference: item.answer,
      equivalent_atomic: {
        before_dispatch: item.answer.after_first_dispatch.filter(
          (step) => step.kind !== 'release_hold',
        ),
      },
      s1_only_global_withdrawal: s1Only(item),
      static_s2_allow: staticS2(item, true),
      static_s2_deny: staticS2(item, false),
      no_action: {},
      permanent_hold: { before_dispatch: [{ kind: 'scope_hold', scope: 'all-ssn-reports' }] },
      blanket_pause: { before_dispatch: [{ kind: 'pause_publisher' }] },
    };
    result.controls[index] = {
      seed,
      arm,
      results: Object.fromEntries(
        Object.entries(choices).map(([name, plan]) => {
          const graded = gradeResponse(JSON.stringify(plan), seed, arm);
          return [
            name,
            {
              valid: graded.valid,
              exact: graded.exact,
              fields: graded.fields,
              task_error: graded.task_error,
              unauthorized_recipient_cells: graded.terminal?.unauthorized_recipient_cells,
              missing_required_cells: graded.terminal?.missing_required_cells,
              native_etl_receipts: graded.terminal?.native_future_etl_sink.length,
            },
          ];
        }),
      ),
    };
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
