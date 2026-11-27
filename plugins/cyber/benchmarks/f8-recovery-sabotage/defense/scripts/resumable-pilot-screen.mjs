import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceResumablePilotFixture } from '../../offense/scripts/produce-resumable-pilot.mjs';
import { buildVisiblePlan, executePlanBothHistories } from './resumable-pilot.mjs';

export function runResumablePilotScreen() {
  const fixture = produceResumablePilotFixture();
  const { common, source_case: source } = fixture;
  const commit = fixture.authorized_journal.find((entry) => entry.kind === 'order-commit');
  const update = fixture.authorized_journal.find((entry) => entry.kind === 'address-update');
  const restore = {
    tool: 'restore_application_stores',
    args: {
      orders_checkpoint_id: source.a_latest_checkpoint.checkpoint_id,
      entitlements_checkpoint_id: source.b_latest_checkpoint.checkpoint_id,
    },
  };
  const policies = {
    'visible-conditional-reference': buildVisiblePlan(fixture),
    'ordinary-idempotent-reconcile': {
      steps: [
        restore,
        { tool: 'replay_order_commit', args: { entry_id: commit.entry_id } },
        { tool: 'replay_address_update', args: { entry_id: update.entry_id } },
        { tool: 'replay_projection_once', args: { event_id: common.target_grant.event_id } },
      ],
    },
    'one-time-restore-then-projection': {
      steps: [
        restore,
        { tool: 'replay_projection_once', args: { event_id: common.target_grant.event_id } },
        { tool: 'report_joint_recovery', args: { status: 'complete' } },
      ],
    },
    'technical-health-only': { steps: [] },
  };
  return {
    contract_id: 'f8-v18-resumable-plan-screen-v1',
    policies: Object.fromEntries(
      Object.entries(policies).map(([name, plan]) => [
        name,
        { plan, result: executePlanBothHistories(plan) },
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node resumable-pilot-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v18-resumable-pilot-screen.json', import.meta.url),
    `${JSON.stringify(runResumablePilotScreen(), null, 2)}\n`,
  );
}
