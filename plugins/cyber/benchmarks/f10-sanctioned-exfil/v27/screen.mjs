#!/usr/bin/env node
import assert from 'node:assert/strict';

import { produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePolicy } from './scorer.mjs';

const seed = 69001;
const early = produceCase(seed, 'early');
const late = produceCase(seed, 'late');
assert.deepEqual(early.observation, late.observation);
const onlyEffectiveTime = structuredClone(early.future);
onlyEffectiveTime.assignment_revision.effective_at = late.future.assignment_revision.effective_at;
assert.deepEqual(onlyEffectiveTime, late.future);
assert.equal(verifyNativeProof(early.proof), true);
assert.equal(verifyNativeProof(late.proof), true);

const visible = respond(early.observation);
const staticRelease = {
  ...visible,
  install_guard: {
    ...visible.install_guard,
    allow_if_all: visible.install_guard.allow_if_all.filter(
      (atom) => atom.right !== 'assignment.active_account_ids_at_dispatch',
    ),
  },
};
const staticHoldC = {
  ...staticRelease,
  install_guard: {
    ...staticRelease.install_guard,
    allow_if_all: [
      ...staticRelease.install_guard.allow_if_all,
      { left: 'cell.account_id', op: 'ne', right_literal: 'acct-C' },
    ],
  },
};
const withoutDedupe = {
  ...visible,
  install_guard: {
    ...visible.install_guard,
    allow_if_all: visible.install_guard.allow_if_all.filter(
      (atom) => atom.right !== 'receipts.delivered_cell_keys_for_report_recipient',
    ),
  },
};
const wrongScope = {
  ...visible,
  install_guard: {
    ...visible.install_guard,
    scope: { ...visible.install_guard.scope, recipient_id: 'neighbor-recipient' },
  },
};
const reversedAtoms = {
  ...visible,
  install_guard: {
    ...visible.install_guard,
    allow_if_all: [...visible.install_guard.allow_if_all].reverse(),
  },
};
const choices = {
  visible_reference: visible,
  reversed_equivalent: reversedAtoms,
  no_action: {},
  old_id_hold: { hold_delivery_ids: [early.observation.held_prior_delivery_id] },
  static_c_release: staticRelease,
  static_c_hold: staticHoldC,
  no_receipt_dedupe: withoutDedupe,
  wrong_scope: wrongScope,
  blanket_pause: { ...visible, pause_publisher: true },
};
const results = {};
for (const [name, action] of Object.entries(choices)) {
  results[name] = {};
  for (const arm of ['early', 'late']) {
    const scored = scorePolicy(seed, arm, action);
    const terminal = scored.terminal;
    results[name][arm] = {
      exact: scored.exact,
      fields: scored.fields,
      new_recipient_rows: terminal.new_recipient_rows,
      new_prohibited_cells: terminal.new_prohibited_cells,
      duplicate_delivery: terminal.duplicate_delivery,
      missing_required_cells: terminal.missing_required_cells,
      native_future_etl_receipts: terminal.native_future_etl_receipts,
    };
  }
}
assert.equal(results.visible_reference.early.exact, true);
assert.equal(results.visible_reference.late.exact, true);
assert.equal(results.reversed_equivalent.early.exact, true);
assert.equal(results.reversed_equivalent.late.exact, true);
for (const [name, arms] of Object.entries(results)) {
  if (['visible_reference', 'reversed_equivalent'].includes(name)) continue;
  assert.equal(Object.values(arms).every((arm) => arm.exact), false, name);
}
const permuted = structuredClone(early.observation);
permuted.stage_manifests.reverse();
permuted.account_membership_ledger.owner_rows.reverse();
permuted.prior_recipient_receipts.reverse();
for (const stage of permuted.stage_manifests) stage.source_cells?.reverse();
assert.equal(scorePolicy(seed, 'early', respond(permuted)).exact, true);
assert.equal(scorePolicy(seed, 'late', respond(permuted)).exact, true);

process.stdout.write(`${JSON.stringify({
  schema_version: 'f10-v27-guard-screen-v1',
  seed,
  visible_observations_identical: true,
  matched_change: 'authenticated-assignment-revision.effective_at:140-versus-160',
  future_dispatch_time: 145,
  reference_rule: visible,
  results,
  neutral_order_reference_exact: '2/2',
  model_calls: 0,
}, null, 2)}\n`);
