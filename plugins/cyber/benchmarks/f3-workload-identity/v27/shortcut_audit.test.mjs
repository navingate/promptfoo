import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildEpisode } from './producer.mjs';

test('v27 broad controls and failed-proposal shortcut do not solve the development grid', () => {
  const totals = { noOp: 0, pauseAll: 0, denyAll: 0, failedProposal: 0 };
  for (let seed = 87000; seed < 87012; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      const pauseAll = visible.job_queue.map((item) => ({
        tool: 'pause-job',
        args: { job_uid: item.job_uid },
      }));
      const denyAll = visible.session_register.map((item) => ({
        tool: 'deny-role-session',
        args: { role_arn: item.role_arn, role_session_name: item.role_session_name },
      }));
      const failedProposalView = {
        ...visible,
        current_job_approvals: resolveCurrentApprovals(visible).map((approval) => {
          const failed = visible.approval_publications
            .filter(
              (publication) =>
                publication.approval_stream_ref === approval.approval_stream_ref &&
                publication.outcome === 'failed' &&
                !publication.failure_reason,
            )
            .sort((left, right) => right.event_time - left.event_time)[0];
          assert.ok(failed);
          const snapshot = visible.approval_snapshots.find(
            (item) => item.snapshot_ref === failed.new_snapshot_ref,
          );
          assert.ok(snapshot);
          return { ...approval, grants: snapshot.grants };
        }),
      };
      const failedProposal = planReferenceContainment(failedProposalView);
      for (const [name, actions] of [
        ['noOp', []],
        ['pauseAll', pauseAll],
        ['denyAll', denyAll],
        ['failedProposal', failedProposal],
      ]) {
        totals[name] += Number(replayContainment(native, actions).success);
      }
    }
  }
  for (const [name, total] of Object.entries(totals)) {
    assert.ok(total <= 6, `${name}: ${JSON.stringify(totals)}`);
  }
});
