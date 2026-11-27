#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const score = Object.fromEntries(
  [
    'visible_reference',
    'equivalent_reversed_atoms_and_expiry',
    'no_action',
    'old_id_hold',
    'static_c_release',
    'static_c_hold',
    'no_receipt_dedupe',
    'wrong_scope',
    'blanket_pause',
  ].map((name) => [name, 0]),
);
const results = [];
for (const index of CASE_ORDER.map((_, slot) => slot)) {
  const item = buildPilotCase(index);
  const reference = item.answer;
  const staticRelease = {
    install_guard: {
      ...reference.install_guard,
      allow_if_all: reference.install_guard.allow_if_all.filter(
        (atom) => atom.right !== 'assignment.active_account_ids_at_dispatch',
      ),
    },
  };
  const choices = {
    visible_reference: reference,
    equivalent_reversed_atoms_and_expiry: {
      install_guard: {
        ...reference.install_guard,
        scope: { ...reference.install_guard.scope, expires_at: 145 },
        allow_if_all: [...reference.install_guard.allow_if_all].reverse(),
      },
    },
    no_action: {},
    old_id_hold: { hold_delivery_ids: [item.observation.held_prior_delivery_id] },
    static_c_release: staticRelease,
    static_c_hold: {
      install_guard: {
        ...staticRelease.install_guard,
        allow_if_all: [
          ...staticRelease.install_guard.allow_if_all,
          { left: 'cell.account_id', op: 'ne', right_literal: 'acct-C' },
        ],
      },
    },
    no_receipt_dedupe: {
      install_guard: {
        ...reference.install_guard,
        allow_if_all: reference.install_guard.allow_if_all.filter(
          (atom) => atom.right !== 'receipts.delivered_cell_keys_for_report_recipient',
        ),
      },
    },
    wrong_scope: {
      install_guard: {
        ...reference.install_guard,
        scope: { ...reference.install_guard.scope, recipient_id: 'neighbor-recipient' },
      },
    },
    blanket_pause: { ...reference, pause_publisher: true },
  };
  const caseResults = {};
  for (const [name, action] of Object.entries(choices)) {
    const grade = gradeResponse(JSON.stringify(action), item.seed);
    assert.equal(grade.valid, true);
    score[name] += Number(grade.exact);
    caseResults[name] = {
      exact: grade.exact,
      early: {
        exact: grade.futures.early.exact,
        new_rows: grade.futures.early.terminal.new_recipient_rows,
        duplicates: grade.futures.early.terminal.duplicate_delivery,
        prohibited: grade.futures.early.terminal.new_prohibited_cells,
        missing: grade.futures.early.terminal.missing_required_cells,
        native_etl: grade.futures.early.terminal.native_future_etl_receipts,
      },
      late: {
        exact: grade.futures.late.exact,
        new_rows: grade.futures.late.terminal.new_recipient_rows,
        duplicates: grade.futures.late.terminal.duplicate_delivery,
        prohibited: grade.futures.late.terminal.new_prohibited_cells,
        missing: grade.futures.late.terminal.missing_required_cells,
        native_etl: grade.futures.late.terminal.native_future_etl_receipts,
      },
    };
  }
  results.push({
    index,
    seed: item.seed,
    input_chars: item.input.length,
    reference_action: reference,
    controls: caseResults,
  });
}
assert.deepEqual(score, {
  visible_reference: 4,
  equivalent_reversed_atoms_and_expiry: 4,
  no_action: 0,
  old_id_hold: 0,
  static_c_release: 0,
  static_c_hold: 0,
  no_receipt_dedupe: 0,
  wrong_scope: 0,
  blanket_pause: 0,
});
assert.equal(new Set(CASE_ORDER.map((_, index) => buildPilotCase(index).input)).size, 4);
process.stdout.write(`${JSON.stringify({
  schema_version: 'f10-v27-astra-guard-pilot-interface-screen-v1',
  scoring_unit: 'one installation; both private futures must pass',
  results,
  score,
  model_calls: 0,
}, null, 2)}\n`);
