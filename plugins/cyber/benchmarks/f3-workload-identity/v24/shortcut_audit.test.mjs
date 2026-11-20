import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

test('v24 broad and both-phases shortcuts disrupt approved planned work', () => {
  const totals = {
    reference: 0,
    noOp: 0,
    pauseAll: 0,
    denyAll: 0,
    bothPhases: 0,
    failedProposal: 0,
  };
  for (let seed = 75000; seed < 75012; seed += 1) {
    for (const family of FAMILIES) {
      const spec = { seed, family };
      const { visible, native } = buildEpisode(spec);
      const reference = referenceDefense(buildDefenseSession(spec));
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
          const proposal = visible.approval_snapshots.find(
            (item) => item.snapshot_ref === failed.new_snapshot_ref,
          );
          assert.ok(proposal);
          return { ...approval, grants: proposal.grants };
        }),
      };
      const failedProposal = planReferenceContainment(failedProposalView);
      const pauseAll = visible.job_queue.map((item) => ({
        tool: 'pause-job',
        args: { job_uid: item.job_uid },
      }));
      const denyAll = visible.session_register.map((item) => ({
        tool: 'deny-role-session',
        args: { role_arn: item.role_arn, role_session_name: item.role_session_name },
      }));
      const unsafeJobs = new Set();
      for (const action of reference) {
        if (action.tool === 'pause-job') {
          unsafeJobs.add(action.args.job_uid);
        } else {
          const session = native.sessions.find(
            (item) =>
              item.role_arn === action.args.role_arn &&
              item.role_session_name === action.args.role_session_name,
          );
          assert.ok(session);
          unsafeJobs.add(session.job_uid);
        }
      }
      const bothPhases = [...pauseAll, ...denyAll].filter((action) => {
        if (action.tool === 'pause-job') {
          return unsafeJobs.has(action.args.job_uid);
        }
        const session = native.sessions.find(
          (item) =>
            item.role_arn === action.args.role_arn &&
            item.role_session_name === action.args.role_session_name,
        );
        return unsafeJobs.has(session.job_uid);
      });
      for (const [name, actions] of [
        ['reference', reference],
        ['noOp', []],
        ['pauseAll', pauseAll],
        ['denyAll', denyAll],
        ['bothPhases', bothPhases],
        ['failedProposal', failedProposal],
      ]) {
        totals[name] += Number(replayContainment(native, actions).success);
      }
    }
  }
  assert.equal(totals.reference, 36);
  for (const name of ['noOp', 'pauseAll', 'denyAll', 'bothPhases', 'failedProposal']) {
    assert.ok(totals[name] <= 6, `${name}: ${JSON.stringify(totals)}`);
  }
});
