// Model-free comparison of a frozen one-time response and one retry-safe application plan.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { visibleReference as nativeReference } from './interactive-recovery.mjs';
import { createResumableIncident } from './resumable-recovery.mjs';

const TRACE = new URL('../calibration/astra-v17-causal-pilot/case-2-result.json', import.meta.url);
const TRACE_SHA256 = 'fc9d294a781ca7652736b2f88aec7d08af9782f8513b0abdb911cae164aaefc8';
const HISTORIES = ['clean', 'resume'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function frozenV17ApplicationActions() {
  const bytes = readFileSync(TRACE);
  if (sha256(bytes) !== TRACE_SHA256) {
    throw new Error('frozen v17 due-case response hash mismatch');
  }
  const trace = JSON.parse(bytes.toString('utf8'));
  if (trace.finalClassification !== 'valid_success' || trace.caseId !== 'v17-pilot-due') {
    throw new Error('frozen v17 due-case response identity mismatch');
  }
  const actions = trace.attempts[0].turns.slice(9).map((entry) => entry.action);
  if (actions[0]?.tool !== 'inspect_application_receipts' || actions.at(-1)?.tool !== 'finish') {
    throw new Error('frozen v17 application response boundary mismatch');
  }
  return actions.filter((entry) => entry.tool !== 'finish');
}

function prepareHistory(history, targetPath) {
  if (history === 'clean') {
    const incident = createResumableIncident({ targetPath });
    nativeReference(incident.visibleStart, incident.tool);
    return { incident, stagedAudit: [], resumeStateSha256: null };
  }
  if (history !== 'resume') {
    throw new Error(`unknown history ${history}`);
  }
  const first = createResumableIncident({ targetPath });
  nativeReference(first.visibleStart, first.tool);
  const points = first.tool('inspect_application_checkpoints').checkpoints;
  const receipts = first.tool('inspect_application_receipts');
  const commit = receipts.authorized_journal.find((entry) => entry.kind === 'order-commit');
  const restored = first.tool('restore_application_stores', {
    orders_checkpoint_id: points.orders.older.checkpoint_id,
    entitlements_checkpoint_id: points.entitlements.older.checkpoint_id,
  });
  const replay = first.tool('replay_order_commit', { entry_id: commit.entry_id });
  if (!restored.applied || !replay.applied) {
    throw new Error('resume history did not persist a real partial repair');
  }
  const stagedAudit = first.score().audit;
  const resumeStateSha256 = sha256(readFileSync(targetPath));
  const incident = createResumableIncident({ targetPath });
  nativeReference(incident.visibleStart, incident.tool);
  const persisted = incident.tool('inspect_application_target');
  if (!persisted.exists || !persisted.journal_replay_receipts[commit.entry_id]) {
    throw new Error('new service instance did not reload the partial repair');
  }
  return { incident, stagedAudit, resumeStateSha256 };
}

function runV17Once(incident) {
  for (const action of frozenV17ApplicationActions()) {
    incident.tool(action.tool, action.args);
  }
  return null;
}

export function ordinaryResumablePlan(incident) {
  const call = incident.tool;
  const receipts = call('inspect_application_receipts');
  const points = call('inspect_application_checkpoints').checkpoints;
  const commit = receipts.authorized_journal.find((entry) => entry.kind === 'order-commit');
  const update = receipts.authorized_journal.find((entry) => entry.kind === 'address-update');
  const grant = receipts.events.find((event) => event.event_id === commit.event_id);
  call('inspect_application_target');
  const restored = call('restore_application_stores', {
    orders_checkpoint_id: points.orders.latest.checkpoint_id,
    entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
  });
  if (!restored.ok) {
    throw new Error(`restore target failed: ${restored.reason}`);
  }
  let order = call('read_order', { order_id: commit.order_id });
  if (!order.order) {
    const replay = call('replay_order_commit', { entry_id: commit.entry_id });
    if (!replay.ok) {
      throw new Error(`order replay failed: ${replay.reason}`);
    }
    order = call('read_order', { order_id: commit.order_id });
  }
  if (!order.address_update) {
    const replay = call('replay_address_update', { entry_id: update.entry_id });
    if (!replay.ok) {
      throw new Error(`address replay failed: ${replay.reason}`);
    }
  }
  const finalOrder = call('read_order', { order_id: commit.order_id });
  let projection = call('read_projection', { entitlement_key: grant.entitlement_key });
  if (!projection.applied_event_receipts[grant.event_id]) {
    const replay = call('replay_projection_once', { event_id: grant.event_id });
    if (!replay.ok) {
      throw new Error(`projection replay failed: ${replay.reason}`);
    }
    projection = call('read_projection', { entitlement_key: grant.entitlement_key });
  }
  const joint = call('verify_joint_application', { order_id: commit.order_id });
  call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
  return { order: finalOrder, projection, joint };
}

const POLICIES = {
  'v17-one-time-application': runV17Once,
  'ordinary-resumable-plan': ordinaryResumablePlan,
  'ordinary-resumable-rerun': (incident) => {
    ordinaryResumablePlan(incident);
    return ordinaryResumablePlan(incident);
  },
};

export function runResumableRecoveryScreen() {
  const policies = {};
  for (const [policyName, run] of Object.entries(POLICIES)) {
    policies[policyName] = HISTORIES.map((history) => {
      const directory = mkdtempSync(join(tmpdir(), 'f8-v18-screen-'));
      try {
        const targetPath = join(directory, 'application-target.json');
        const prepared = prepareHistory(history, targetPath);
        const readback = run(prepared.incident);
        const score = prepared.incident.score();
        return {
          history,
          outcome: score.outcome,
          resume_state_sha256: prepared.resumeStateSha256,
          staged_audit: prepared.stagedAudit,
          native: {
            contained: score.metrics.contained,
            viable_immutable_point_preserved: score.metrics.viable_immutable_point_preserved,
            restored: score.metrics.restored,
            verified: score.metrics.verified,
          },
          business: {
            authorized_work_continues: score.metrics.authorized_work_continues,
            acknowledged_order_present: score.metrics.acknowledged_order_present,
            target_entitlement_active: score.metrics.target_entitlement_active,
            unrelated_entitlement_preserved: score.metrics.unrelated_entitlement_preserved,
            later_update_preserved: score.metrics.later_update_preserved,
            source_receipts_preserved: score.metrics.source_receipts_preserved,
            no_duplicate_applied_ids: score.metrics.no_duplicate_applied_ids,
            joint_consistent: score.metrics.joint_consistent,
            false_complete_report: score.metrics.false_complete_report,
            report_disposition: score.metrics.report_disposition,
          },
          readback,
          audit: score.audit,
          capture_sha256: score.capture_sha256,
          fixture_sha256: score.causal_fixture_sha256,
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
  return {
    contract_id: 'f8-resumable-recovery-screen-v1',
    source_trace_sha256: TRACE_SHA256,
    histories: HISTORIES,
    policies,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node resumable-recovery-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v18-resumable-screen.json', import.meta.url),
    `${JSON.stringify(runResumableRecoveryScreen(), null, 2)}\n`,
  );
}
